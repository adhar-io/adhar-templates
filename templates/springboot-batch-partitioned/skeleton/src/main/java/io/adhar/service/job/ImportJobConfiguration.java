package io.adhar.service.job;

import com.adhar.kit.batch.annotation.AdharBatchJob;
import com.adhar.kit.batch.annotation.JobParam;
import com.adhar.kit.batch.annotation.ParamSource;
import com.adhar.kit.batch.annotation.ParamType;
import com.adhar.kit.batch.fault.FaultTolerance;
import com.adhar.kit.batch.partition.ConditionalOnBatchRole;
import com.adhar.kit.batch.partition.RemotePartitioning;
import com.adhar.kit.batch.partitioner.SqlKeyRangePartitioner;
import com.adhar.kit.batch.reader.KeysetPagingItemReaderBuilder;
import com.adhar.kit.batch.runtime.BatchRole;
import com.adhar.kit.batch.step.AdharSteps;
import com.adhar.kit.batch.writer.PostgresUpsertItemWriterBuilder;
import java.time.LocalDate;
import javax.sql.DataSource;
import org.springframework.batch.core.configuration.annotation.StepScope;
import org.springframework.batch.core.job.Job;
import org.springframework.batch.core.job.builder.JobBuilder;
import org.springframework.batch.core.repository.JobRepository;
import org.springframework.batch.core.step.Step;
import org.springframework.batch.infrastructure.item.database.JdbcBatchItemWriter;
import org.springframework.batch.infrastructure.item.database.JdbcPagingItemReader;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The job, for every pod of a run (design 0025 §5.10, §9.2): ONE configuration, and which half of
 * it a pod builds is its role ({@code ADHAR_BATCH_ROLE}, which the BatchJob composition sets).
 *
 * <pre>
 * bean            manager   worker   single (a local run, a test)
 * importJob       yes       yes      yes      the manager step inside it is the role's (below)
 * importStep      -         yes      yes      @ConditionalOnBatchRole(WORKER)
 * rangeReader     -         yes      yes      @StepScope: one per partition, reading minKey..maxKey
 * recordProcessor -         yes      yes      @StepScope: stamps the run's business date
 * outputWriter    -         yes      yes
 * </pre>
 *
 * <ul>
 *   <li>The <b>manager</b> splits {@value #INPUT_TABLE} into {@code adhar.batch.partition.grid-size}
 *       key ranges ({@link SqlKeyRangePartitioner}, NTILE: equal row counts) and writes one request per
 *       range into the partition channel in the job's own database. It never reads a row itself.</li>
 *   <li>Each <b>worker</b> claims a request, runs {@value #WORKER_STEP} over that range in chunks, and
 *       claims the next, until the run is over. Its reads, its upserts and Spring Batch's progress share
 *       one transaction per chunk, so a restarted partition resumes after its last commit and a worker
 *       that was given up on cannot commit into a partition that runs again.</li>
 *   <li>Role <b>single</b> runs the same partitions in this one process.</li>
 * </ul>
 *
 * <p>The job is defined in every role: a worker computes the run's identity from the parameters
 * {@link AdharBatchJob} declares, exactly as the manager does, which is how it finds the run's
 * requests. Those declarations are {@code deploy/base/batchjob.yaml}'s {@code parameters};
 * {@code BatchJobContractTest} fails the build when the two differ.</p>
 *
 * <p>There is no {@code @EnableBatchProcessing} (on Spring Boot it switches the batch
 * auto-configuration, and with it the kit's, OFF) and no incrementer (it would make Spring Batch
 * ignore the run's parameters, and with them its identity).</p>
 */
@Configuration(proxyBeanMethods = false)
public class ImportJobConfiguration {

    /** The job's bean name: {@code spec.parameters.job} in batchjob.yaml, {@code ADHAR_BATCH_JOB} on every pod. */
    public static final String JOB = "importJob";
    /** The manager step: the one step of the job. */
    public static final String MANAGER_STEP = "importManager";
    /** The worker step, and its bean name: partitions are {@code importStep:partition<n>}. */
    public static final String WORKER_STEP = "importStep";
    /** Identifying parameter: the day a run processes (derived from the schedule). */
    public static final String BUSINESS_DATE = "businessDate";
    /** Identifying parameter: where a run reads from. */
    public static final String SOURCE = "source";
    /** The business table the manager splits and the workers read. */
    public static final String INPUT_TABLE = "public.batch_input";
    /** Where the workers write: one row per input row, upserted on its key. */
    public static final String OUTPUT_TABLE = "public.batch_output";
    /** The key both tables share, and the partitioner splits on. */
    public static final String KEY = "id";

    @Bean(JOB)
    @AdharBatchJob(description = "Imports batch_input into batch_output, partitioned over a manager and workers",
            parameters = {
                    @JobParam(name = BUSINESS_DATE, type = ParamType.DATE, source = ParamSource.SCHEDULE,
                            description = "The day this run processes."),
                    @JobParam(name = SOURCE, defaultValue = "database", allowed = "database",
                            description = "Where this run reads from — the batch_input table, split into key ranges.")})
    public Job importJob(JobRepository jobRepository, RemotePartitioning partitioning, DataSource dataSource) {
        return new JobBuilder(JOB, jobRepository)
                .start(partitioning.manager(MANAGER_STEP, WORKER_STEP,
                        SqlKeyRangePartitioner.of(dataSource, INPUT_TABLE, KEY).build()))
                .build();
    }

    /**
     * The worker: a chunk-oriented step over one partition's key range. Chunks default to
     * {@code adhar.batch.chunk.size}. A record the processor refuses ({@link InvalidRecordException})
     * is skipped and written to the kit's dead-letter table, up to {@code batch.skip-limit} per
     * partition; past that the partition fails with exit 3 (not retryable). A transient database
     * failure is retried with the kit's back-off.
     */
    @Bean(WORKER_STEP)
    @ConditionalOnBatchRole(BatchRole.WORKER)
    public Step importStep(AdharSteps steps, JdbcPagingItemReader<InputRecord> rangeReader, RecordProcessor processor,
                           JdbcBatchItemWriter<OutputRecord> outputWriter,
                           @Value("${batch.skip-limit:10}") long skipLimit) {
        return steps.<InputRecord, OutputRecord>chunk(WORKER_STEP)
                .reader(rangeReader)
                .processor(processor)
                .writer(outputWriter)
                .faultTolerance(FaultTolerance.transientInfrastructure()
                        .skip(InvalidRecordException.class, skipLimit)
                        .deadLetter())
                .build();
    }

    /**
     * One reader per partition: the range the manager recorded for it ({@code minKey}..{@code maxKey},
     * inclusive), paged by key so a restart continues after the last key it committed. A partition
     * whose range holds no rows has no keys; it reads nothing.
     */
    @Bean
    @StepScope
    @ConditionalOnBatchRole(BatchRole.WORKER)
    public JdbcPagingItemReader<InputRecord> rangeReader(DataSource dataSource,
                                                         @Value("#{stepExecutionContext['minKey']}") Long minKey,
                                                         @Value("#{stepExecutionContext['maxKey']}") Long maxKey) {
        return KeysetPagingItemReaderBuilder.of(dataSource, InputRecord.class)
                .name("rangeReader")
                .select("id, payload")
                .from(INPUT_TABLE)
                .where(KEY + " BETWEEN :minKey AND :maxKey")
                .parameter("minKey", minKey == null ? 1L : minKey)
                .parameter("maxKey", maxKey == null ? 0L : maxKey)
                .key(KEY)
                .build();
    }

    /** One per partition, so it knows the run's business date, which it stamps on every row. */
    @Bean
    @StepScope
    @ConditionalOnBatchRole(BatchRole.WORKER)
    public RecordProcessor recordProcessor(@Value("#{jobParameters['" + BUSINESS_DATE + "']}") LocalDate businessDate) {
        return new RecordProcessor(businessDate);
    }

    /**
     * An upsert on the key: writing a row twice leaves one row, so a chunk a retry writes again is
     * still exactly once. The step's transaction makes the chunk's rows and its progress one commit.
     */
    @Bean
    @ConditionalOnBatchRole(BatchRole.WORKER)
    public JdbcBatchItemWriter<OutputRecord> outputWriter(DataSource dataSource) {
        return PostgresUpsertItemWriterBuilder.<OutputRecord>into(dataSource, OUTPUT_TABLE)
                .columns(KEY, "payload", "business_date")
                .conflictOn(KEY)
                .build();
    }
}
