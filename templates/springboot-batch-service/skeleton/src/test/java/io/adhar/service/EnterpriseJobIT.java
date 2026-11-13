package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.adhar.kit.batch.operator.BatchOperator;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.batch.core.BatchStatus;
import org.springframework.batch.core.job.Job;
import org.springframework.batch.core.job.JobExecution;
import org.springframework.batch.core.job.parameters.JobParameters;
import org.springframework.batch.core.job.parameters.JobParametersBuilder;
import org.springframework.batch.core.step.StepExecution;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Runs the sample job end to end through the kit's {@link BatchOperator}, against the
 * JobRepository the service is configured with, and checks that the partitions between them
 * read every item exactly once. Each test is its own JobInstance (a unique {@code run.id} is
 * part of these identities, which a platform run never has); PlatformRunLauncherIT covers the
 * identity a run gets on the platform.
 */
@SpringBootTest(properties = {
        "batch.partition-count=2",
        "batch.backoff-ms=1",
        "batch.items=alpha,beta,gamma,delta,epsilon",
        // No collector on the test host: nothing to push to.
        "management.otlp.metrics.export.enabled=false",
})
@Import(TestcontainersConfiguration.class)
class EnterpriseJobIT {

    @Autowired
    private BatchOperator batchOperator;

    @Autowired
    private Job enterpriseJob;

    @Autowired
    private MeterRegistry meterRegistry;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void readsTheSampleFileAcrossPartitions() throws Exception {
        JobExecution execution = batchOperator.start(enterpriseJob, parameters("file"));

        assertThat(execution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        List<StepExecution> workers = workerExecutions(execution);
        assertThat(workers).hasSize(2);
        assertThat(workers.stream().mapToLong(StepExecution::getReadCount).sum()).isEqualTo(10);
        assertThat(workers.stream().mapToLong(StepExecution::getWriteCount).sum()).isEqualTo(10);
        assertThat(meterRegistry.find("batch.job.finish").tag("status", "COMPLETED").counter()).isNotNull();
    }

    @Test
    void sourceParameterSwitchesTheInputOfOneRun() throws Exception {
        JobExecution execution = batchOperator.start(enterpriseJob, parameters("list"));

        assertThat(execution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        List<StepExecution> workers = workerExecutions(execution);
        assertThat(workers.stream().mapToLong(StepExecution::getReadCount).sum()).isEqualTo(5);
        assertThat(workers.stream().mapToLong(StepExecution::getReadCount)).containsExactlyInAnyOrder(3L, 2L);
    }

    @Test
    void readsTheDatabaseTableAcrossPartitions() throws Exception {
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS batch_input (id BIGINT PRIMARY KEY, payload VARCHAR(255) NOT NULL)");
        jdbcTemplate.update("DELETE FROM batch_input");
        for (int i = 1; i <= 7; i++) {
            jdbcTemplate.update("INSERT INTO batch_input (id, payload) VALUES (?, ?)", i, "row-" + i);
        }

        JobExecution execution = batchOperator.start(enterpriseJob, parameters("database"));

        assertThat(execution.getStatus()).isEqualTo(BatchStatus.COMPLETED);
        List<StepExecution> workers = workerExecutions(execution);
        assertThat(workers.stream().mapToLong(StepExecution::getReadCount).sum()).isEqualTo(7);
        assertThat(workers.stream().mapToLong(StepExecution::getWriteCount).sum()).isEqualTo(7);
    }

    private static JobParameters parameters(String source) {
        return new JobParametersBuilder()
                .addLong("run.id", System.nanoTime())
                .addLocalDate(BatchConfiguration.BUSINESS_DATE_PARAMETER, LocalDate.of(2026, 11, 3))
                .addString(BatchConfiguration.SOURCE_PARAMETER, source)
                .toJobParameters();
    }

    /** The partitioned worker executions, named {@code workerStep:partitionN}. */
    private static List<StepExecution> workerExecutions(JobExecution execution) {
        return execution.getStepExecutions().stream()
                .filter(step -> step.getStepName().startsWith(BatchConfiguration.WORKER_STEP + ":"))
                .toList();
    }
}
