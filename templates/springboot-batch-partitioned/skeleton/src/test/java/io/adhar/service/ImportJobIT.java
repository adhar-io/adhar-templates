package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.adhar.kit.batch.partition.RemotePartitioning;
import com.adhar.kit.batch.runtime.BatchRole;
import com.adhar.kit.test.batch.AdharBatchTest;
import io.adhar.service.job.ImportJobConfiguration;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.batch.core.BatchStatus;
import org.springframework.batch.core.job.JobExecution;
import org.springframework.batch.core.job.parameters.JobParameters;
import org.springframework.batch.core.job.parameters.JobParametersBuilder;
import org.springframework.batch.core.step.StepExecution;
import org.springframework.batch.test.JobOperatorTestUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The job in role {@code single} — a local run, or this test: the manager and every partition in one
 * process, through the same {@code @Configuration} the pods of a partitioned run build from. The real
 * auto-configuration on PostgreSQL 18.4 ({@link AdharBatchTest}), with the platform's grid of
 * partitions; PartitionedJobIT runs the manager and the workers as separate pods.
 */
@AdharBatchTest(properties = {
        "adhar.batch.partition.grid-size=4",
        "adhar.batch.chunk.size=25",
        "batch.skip-limit=2",
        // No collector on the test host: nothing to push to.
        "management.otlp.metrics.export.enabled=false",
        "adhar.tracing.open-telemetry.enabled=false",
})
class ImportJobIT {

    private static final int ROWS = 200;

    @Autowired
    private JobOperatorTestUtils jobs;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private RemotePartitioning partitioning;

    @BeforeEach
    void seed() {
        jdbc.update("TRUNCATE public.batch_input, public.batch_output");
        jdbc.update("INSERT INTO public.batch_input SELECT g, 'row-' || g FROM generate_series(1, ?) g", ROWS);
    }

    private static JobParameters day(LocalDate date) {
        return new JobParametersBuilder()
                .addLocalDate(ImportJobConfiguration.BUSINESS_DATE, date)
                .addString(ImportJobConfiguration.SOURCE, "database")
                .toJobParameters();
    }

    private static List<StepExecution> partitions(JobExecution execution) {
        return execution.getStepExecutions().stream()
                .filter(step -> step.getStepName().startsWith(ImportJobConfiguration.WORKER_STEP + ":"))
                .toList();
    }

    @Test
    void importsEveryRowOnceAcrossThePartitions() throws Exception {
        assertThat(partitioning.role()).isEqualTo(BatchRole.SINGLE);

        JobExecution execution = jobs.startJob(day(LocalDate.of(2026, 11, 3)));

        assertThat(execution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        assertThat(partitions(execution)).hasSize(4).allSatisfy(step -> {
            assertThat(step.getStatus()).isEqualTo(BatchStatus.COMPLETED);
            assertThat(step.getWriteCount()).isEqualTo(ROWS / 4);
        });
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.batch_output WHERE business_date = DATE '2026-11-03'",
                Integer.class)).isEqualTo(ROWS);
        assertThat(jdbc.queryForObject("SELECT payload FROM public.batch_output WHERE id = 7", String.class))
                .isEqualTo("ROW_7");
    }

    @Test
    void aRecordTheProcessorRefusesIsDeadLetteredAndTheRunCompletes() throws Exception {
        jdbc.update("UPDATE public.batch_input SET payload = 'FAIL-42' WHERE id = 42");

        JobExecution execution = jobs.startJob(day(LocalDate.of(2026, 11, 4)));

        assertThat(execution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        assertThat(partitions(execution).stream().mapToLong(StepExecution::getSkipCount).sum()).isOne();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.batch_output", Integer.class)).isEqualTo(ROWS - 1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM batch.adhar_batch_dead_letter", Integer.class)).isOne();
    }

    @Test
    void morePoisonThanTheSkipLimitFailsThePartitionAndARestartResumesIt() throws Exception {
        jdbc.update("UPDATE public.batch_input SET payload = 'FAIL-' || id WHERE id IN (60, 61, 62)");
        LocalDate date = LocalDate.of(2026, 11, 5);

        JobExecution failed = jobs.startJob(day(date));

        assertThat(failed.getStatus()).isEqualTo(BatchStatus.FAILED);
        assertThat(partitions(failed).stream().filter(step -> step.getStatus() == BatchStatus.FAILED)).hasSize(1);

        // Fixed at the source, the same day restarts: only the failed partition runs again.
        jdbc.update("UPDATE public.batch_input SET payload = 'row-' || id WHERE id IN (60, 61, 62)");
        JobExecution restarted = jobs.startJob(day(date));

        assertThat(restarted.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        assertThat(restarted.getJobInstance().getInstanceId()).isEqualTo(failed.getJobInstance().getInstanceId());
        assertThat(partitions(restarted)).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.batch_output", Integer.class)).isEqualTo(ROWS);
    }
}
