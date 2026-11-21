{%- if values.inServiceBatch %}
package io.adhar.service.batch;

import java.time.LocalDate;
import javax.sql.DataSource;

import org.springframework.batch.core.configuration.annotation.StepScope;
import org.springframework.batch.core.job.Job;
import org.springframework.batch.core.job.builder.JobBuilder;
import org.springframework.batch.core.repository.JobRepository;
import org.springframework.batch.core.step.Step;
import org.springframework.batch.infrastructure.item.database.JdbcBatchItemWriter;
import org.springframework.batch.infrastructure.item.database.JdbcPagingItemReader;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import com.adhar.kit.batch.annotation.AdharBatchJob;
import com.adhar.kit.batch.annotation.JobParam;
import com.adhar.kit.batch.annotation.ParamSource;
import com.adhar.kit.batch.annotation.ParamType;
import com.adhar.kit.batch.fault.FaultTolerance;
import com.adhar.kit.batch.reader.KeysetPagingItemReaderBuilder;
import com.adhar.kit.batch.step.AdharSteps;
import com.adhar.kit.batch.writer.PostgresUpsertItemWriterBuilder;

/**
 * The sample in-service batch job (design 0025 §5.20): settles a business day's payments, copying
 * each valid row of {@value #INPUT_TABLE} into {@value #OUTPUT_TABLE} in chunks.
 *
 * <p>It runs inside this service, on Adhar Kit's clustered Quartz scheduler, from the triggers in
 * {@code application.properties} ({@code adhar.batch.quartz.triggers.settlementJob}). Every replica
 * shares one schedule in the service's own PostgreSQL, so a slot runs once across them; when a replica
 * dies mid-run, another re-fires it and the kit resumes the run after its last commit
 * ({@code QuartzRestartIT}). The service's own code can start a run too, idempotently by the run's
 * name — {@code BatchTriggers.fireNow("settlementJob", Map.of("businessDate", "2026-11-03"))} twice is
 * one run.</p>
 *
 * <p>A run's identity is its identifying parameters: the business date (a scheduled run's is the
 * slot's date in {@code adhar.batch.scheduler.time-zone}, never {@code now()}) and the cycle the
 * trigger names. The same identity again is the same JobInstance — skipped once it completed,
 * restarted from its last commit when it failed. Reads, upserts and Spring Batch's progress share one
 * transaction per chunk, which is what makes that restart exactly once.</p>
 *
 * <p>There is no {@code @EnableBatchProcessing} (on Spring Boot it switches the batch
 * auto-configuration, and with it the kit's, off) and no incrementer (it would replace the run's
 * identity with a counter). A job that is long, heavy, partitioned or that operators must run, stop
 * and restart belongs in a platform {@code BatchJob} (a batch template), not here: an in-service run
 * shares this pod with the request traffic, and a rollout stops it.</p>
 */
@Configuration(proxyBeanMethods = false)
public class SettlementJobConfiguration {

    /** The job's bean name: the key of its triggers; its schedule (and run) name is {@code settlement-job}. */
    public static final String JOB = "settlementJob";
    /** Its one step. */
    public static final String STEP = "settlementStep";
    /** Identifying: the day a run settles. */
    public static final String BUSINESS_DATE = "businessDate";
    /** Identifying: which of the day's settlements this is, named by the trigger. */
    public static final String CYCLE = "cycle";
    /** What the service has received: one row per payment, its key unique and NOT NULL. */
    public static final String INPUT_TABLE = "public.payments";
    /** What the job writes: one row per settled payment, upserted on its key. */
    public static final String OUTPUT_TABLE = "public.settlements";

    @Bean(JOB)
    @AdharBatchJob(description = "Settles a business day's payments", parameters = {
            @JobParam(name = BUSINESS_DATE, type = ParamType.DATE, source = ParamSource.SCHEDULE,
                    description = "The day this run settles: a scheduled run's slot date."),
            @JobParam(name = CYCLE, defaultValue = "close", allowed = {"close", "intraday"},
                    description = "Which settlement of the day: each runs once per business date.")})
    public Job settlementJob(JobRepository jobRepository, Step settlementStep) {
        return new JobBuilder(JOB, jobRepository).start(settlementStep).build();
    }

    /**
     * Chunks default to {@code adhar.batch.chunk.size}. A payment the processor refuses
     * ({@link InvalidPaymentException}) is skipped and written to the kit's dead-letter table, up to
     * {@code batch.skip-limit} per run; a transient database failure is retried with the kit's back-off.
     */
    @Bean(STEP)
    public Step settlementStep(AdharSteps steps, JdbcPagingItemReader<Payment> paymentReader,
                               SettlementProcessor settlementProcessor, JdbcBatchItemWriter<Settlement> settlementWriter,
                               @Value("${batch.skip-limit:100}") long skipLimit) {
        return steps.<Payment, Settlement>chunk(STEP)
                .reader(paymentReader)
                .processor(settlementProcessor)
                .writer(settlementWriter)
                .faultTolerance(FaultTolerance.transientInfrastructure()
                        .skip(InvalidPaymentException.class, skipLimit)
                        .deadLetter())
                .build();
    }

    /** The day's payments, paged by key, so a restart continues after the last key it committed. */
    @Bean
    @StepScope
    public JdbcPagingItemReader<Payment> paymentReader(DataSource dataSource,
                                                       @Value("#{jobParameters['" + BUSINESS_DATE + "']}") LocalDate businessDate) {
        return KeysetPagingItemReaderBuilder.of(dataSource, Payment.class)
                .name("paymentReader")
                .select("id, business_date, account, amount")
                .from(INPUT_TABLE)
                .where("business_date = :businessDate")
                .parameter("businessDate", businessDate)
                .key("id")
                .build();
    }

    @Bean
    public SettlementProcessor settlementProcessor() {
        return new SettlementProcessor();
    }

    /** An upsert on the payment's key: a chunk written twice is still one row per payment. */
    @Bean
    public JdbcBatchItemWriter<Settlement> settlementWriter(DataSource dataSource) {
        return PostgresUpsertItemWriterBuilder.<Settlement>into(dataSource, OUTPUT_TABLE)
                .columns("payment_id", "business_date", "account", "amount")
                .conflictOn("payment_id")
                .build();
    }

    /**
     * The job's two tables, created when they are missing. A singleton, so it runs while the context
     * starts, before the scheduler can fire. Replace it with the service's migration tool once the
     * service has one; Spring Batch's and Quartz's own tables are the kit's, in schema {@code batch}.
     */
    @Bean
    public InitializingBean settlementTables(JdbcTemplate jdbc) {
        return () -> {
            jdbc.execute("CREATE TABLE IF NOT EXISTS " + INPUT_TABLE + " ("
                    + "id BIGINT PRIMARY KEY, business_date DATE NOT NULL, account TEXT, amount NUMERIC(18, 2))");
            jdbc.execute("CREATE INDEX IF NOT EXISTS payments_business_date ON " + INPUT_TABLE + " (business_date, id)");
            jdbc.execute("CREATE TABLE IF NOT EXISTS " + OUTPUT_TABLE + " ("
                    + "payment_id BIGINT PRIMARY KEY, business_date DATE NOT NULL, account TEXT NOT NULL, "
                    + "amount NUMERIC(18, 2) NOT NULL)");
        };
    }
}
{%- endif %}
