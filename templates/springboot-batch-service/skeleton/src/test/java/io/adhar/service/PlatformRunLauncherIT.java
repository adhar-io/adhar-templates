package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.adhar.kit.batch.operator.BatchOperator;
import com.adhar.kit.batch.operator.JobResolver;
import com.adhar.kit.batch.runtime.ExitCodes;
import io.adhar.service.batch.EnterpriseBatchProperties;
import io.adhar.service.batch.InvalidRunException;
import io.adhar.service.batch.PlatformRun;
import io.adhar.service.batch.PlatformRunLauncher;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.batch.core.BatchStatus;
import org.springframework.batch.core.job.JobExecution;
import org.springframework.batch.core.job.JobInstance;
import org.springframework.batch.core.job.parameters.JobParameters;
import org.springframework.batch.core.job.parameters.JobParametersBuilder;
import org.springframework.batch.core.repository.JobRepository;
import org.springframework.batch.infrastructure.item.ExecutionContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/**
 * Runs the launcher as a run pod would, with the contract the BatchJob composition sets
 * ({@code ADHAR_BATCH_JOB}, {@code _NAME}, {@code _TRIGGER}, {@code _K8S_JOB}, {@code _TIME_ZONE},
 * {@code _PARAMS}), and checks the identity and the exit code a run gets on the platform.
 */
@SpringBootTest(properties = {
        "batch.partition-count=2",
        "batch.backoff-ms=1",
        "batch.retry-limit=1",
        // The `list` input carries a failing item; `file` and `database` do not.
        "batch.items=alpha,beta,FAIL,delta",
        // No collector on the test host: nothing to push to.
        "management.otlp.metrics.export.enabled=false",
})
@Import(TestcontainersConfiguration.class)
class PlatformRunLauncherIT {

    private static final String BATCH_JOB = "demo";
    private static final ZoneId SINGAPORE = ZoneId.of("Asia/Singapore");
    /** 02:00 on 2026-11-03 in Singapore, which is still 2026-11-02 in UTC. */
    private static final Instant NIGHTLY_FIRE = Instant.parse("2026-11-02T18:00:00Z");

    @Autowired
    private BatchOperator batchOperator;

    @Autowired
    private JobResolver jobResolver;

    @Autowired
    private JobRepository jobRepository;

    @Autowired
    private EnterpriseBatchProperties properties;

    @TempDir
    private Path tmp;

    private Path terminationLog;

    @BeforeEach
    void terminationLog() throws IOException {
        terminationLog = Files.createFile(tmp.resolve("termination-log"));
    }

    @Test
    void aScheduledRunIsTheDayOfItsScheduledTimeInTheJobsTimeZone() throws Exception {
        PlatformRunLauncher launcher = launcher(scheduled(NIGHTLY_FIRE, cronJobRun(NIGHTLY_FIRE)));

        launcher.run(new DefaultApplicationArguments());

        assertThat(launcher.getExitCode()).isEqualTo(ExitCodes.COMPLETED);
        assertThat(launcher.outcome()).isEqualTo("completed");
        List<JobExecution> executions = executions(LocalDate.of(2026, 11, 3), "file");
        assertThat(executions).hasSize(1);
        assertThat(executions.get(0).getStatus()).isEqualTo(BatchStatus.COMPLETED);
        assertThat(Files.readString(terminationLog))
                .contains("\"businessDate\":\"2026-11-03\"")
                .contains("\"exitCode\":0")
                .contains("\"trigger\":\"schedule\"");

        // The replacement pod of the same night, or the person re-running it: a no-op.
        PlatformRunLauncher again = launcher(scheduled(NIGHTLY_FIRE, cronJobRun(NIGHTLY_FIRE)));
        again.run(new DefaultApplicationArguments());

        assertThat(again.getExitCode()).isEqualTo(ExitCodes.COMPLETED);
        assertThat(again.outcome()).isEqualTo("skipped(already-complete)");
        assertThat(executions(LocalDate.of(2026, 11, 3), "file")).hasSize(1);
    }

    @Test
    void aFailedRunExitsRetryableAndTheNextAttemptRestartsTheSameInstance() throws Exception {
        PlatformRun manual = manual(Map.of("businessDate", "2026-11-04", "source", "list"));
        PlatformRunLauncher first = launcher(manual);

        first.run(new DefaultApplicationArguments());

        assertThat(first.getExitCode()).isEqualTo(ExitCodes.FAILED_RETRYABLE);
        assertThat(first.outcome()).isEqualTo("failed");

        PlatformRunLauncher second = launcher(manual);
        second.run(new DefaultApplicationArguments());

        assertThat(second.getExitCode()).isEqualTo(ExitCodes.FAILED_RETRYABLE);
        // A restart of the SAME JobInstance, not a new one: Spring Batch resumes from the last commit.
        assertThat(executions(LocalDate.of(2026, 11, 4), "list")).hasSize(2);
    }

    @Test
    void anExecutionLeftStartedByAnEarlierPodOfTheSameKubernetesJobIsRecovered() throws Exception {
        orphan(LocalDate.of(2026, 11, 5), "demo-123");
        PlatformRunLauncher launcher = launcher(new PlatformRun(BatchConfiguration.JOB_BEAN, BATCH_JOB, "manual",
                "alice", "demo-123", SINGAPORE, Map.of("businessDate", "2026-11-05")));

        launcher.run(new DefaultApplicationArguments());

        assertThat(launcher.getExitCode()).isEqualTo(ExitCodes.COMPLETED);
        assertThat(launcher.outcome()).isEqualTo("completed");
        List<JobExecution> executions = executions(LocalDate.of(2026, 11, 5), "file");
        assertThat(executions).hasSize(2);
        assertThat(executions).extracting(JobExecution::getStatus).containsExactlyInAnyOrder(BatchStatus.FAILED, BatchStatus.COMPLETED);
    }

    @Test
    void anExecutionStartedUnderAnotherKubernetesJobIsLeftAlone() throws Exception {
        orphan(LocalDate.of(2026, 11, 6), "demo-999");
        PlatformRunLauncher launcher = launcher(new PlatformRun(BatchConfiguration.JOB_BEAN, BATCH_JOB, "manual",
                "alice", "demo-888", SINGAPORE, Map.of("businessDate", "2026-11-06")));

        launcher.run(new DefaultApplicationArguments());

        assertThat(launcher.getExitCode()).isEqualTo(ExitCodes.COMPLETED);
        assertThat(launcher.outcome()).isEqualTo("skipped(duplicate)");
        List<JobExecution> executions = executions(LocalDate.of(2026, 11, 6), "file");
        assertThat(executions).hasSize(1);
        assertThat(executions.get(0).getStatus()).isEqualTo(BatchStatus.STARTING);
    }

    @Test
    void aRunOffThePlatformIsTodayInTheJobsTimeZone() throws Exception {
        // 23:30 UTC on the 7th is already the 8th in Singapore.
        Clock clock = Clock.fixed(Instant.parse("2026-11-07T23:30:00Z"), ZoneId.of("UTC"));
        PlatformRunLauncher launcher = launcher(
                new PlatformRun(BatchConfiguration.JOB_BEAN, "", "local", "", "", SINGAPORE, Map.of()), clock);

        launcher.run(new DefaultApplicationArguments());

        assertThat(launcher.getExitCode()).isEqualTo(ExitCodes.COMPLETED);
        assertThat(executions(LocalDate.of(2026, 11, 8), "file")).hasSize(1);
    }

    @Test
    void whatCannotBeRunIsAnInvalidRequest() {
        assertThatThrownBy(() -> launcher(new PlatformRun("noSuchJob", BATCH_JOB, "manual", "", "", SINGAPORE,
                Map.of("businessDate", "2026-11-09"))).run(new DefaultApplicationArguments()))
                .isInstanceOf(InvalidRunException.class)
                .satisfies(ex -> assertThat(((InvalidRunException) ex).getExitCode()).isEqualTo(ExitCodes.INVALID_REQUEST))
                .hasMessageContaining("noSuchJob");

        assertThatThrownBy(() -> launcher(manual(Map.of("businessDate", "yesterday"))).run(new DefaultApplicationArguments()))
                .isInstanceOf(InvalidRunException.class)
                .hasMessageContaining("businessDate");

        assertThatThrownBy(() -> launcher(manual(Map.of("businessDate", "2026-11-09", "source", "mainframe")))
                .run(new DefaultApplicationArguments()))
                .isInstanceOf(InvalidRunException.class)
                .hasMessageContaining("source");

        // A scheduled run whose Job the CronJob controller did not name: no scheduled time to derive the day from.
        assertThatThrownBy(() -> launcher(scheduled(NIGHTLY_FIRE, "demo-tonight")).run(new DefaultApplicationArguments()))
                .isInstanceOf(InvalidRunException.class)
                .hasMessageContaining("demo-tonight");

        assertThat(executions(LocalDate.of(2026, 11, 9), "file")).isEmpty();
    }

    /** What the CronJob controller names the Job of a fire: {@code <cronjob>-<minutes since the epoch>}. */
    private static String cronJobRun(Instant fire) {
        return BATCH_JOB + "-" + fire.getEpochSecond() / 60;
    }

    private static PlatformRun scheduled(Instant fire, String k8sJobName) {
        return new PlatformRun(BatchConfiguration.JOB_BEAN, BATCH_JOB, PlatformRun.SCHEDULE_TRIGGER, "", k8sJobName,
                SINGAPORE, Map.of());
    }

    private static PlatformRun manual(Map<String, String> params) {
        return new PlatformRun(BatchConfiguration.JOB_BEAN, BATCH_JOB, "manual", "alice", "demo-4f2a9c1b", SINGAPORE, params);
    }

    private PlatformRunLauncher launcher(PlatformRun run) {
        return launcher(run, Clock.systemUTC());
    }

    private PlatformRunLauncher launcher(PlatformRun run, Clock clock) {
        return new PlatformRunLauncher(run, batchOperator, jobResolver, properties, clock, terminationLog);
    }

    /** An execution a crashed pod of Kubernetes Job {@code owner} left STARTING. */
    private void orphan(LocalDate day, String owner) throws Exception {
        JobParameters parameters = new JobParametersBuilder()
                .addLocalDate(BatchConfiguration.BUSINESS_DATE_PARAMETER, day, true)
                .addString(BatchConfiguration.SOURCE_PARAMETER, "file", true)
                .addString("adhar.k8s.job", owner, false)
                .toJobParameters();
        JobInstance instance = jobRepository.createJobInstance(BatchConfiguration.JOB_NAME, parameters);
        jobRepository.createJobExecution(instance, parameters, new ExecutionContext());
    }

    private List<JobExecution> executions(LocalDate day, String source) {
        JobParameters identity = new JobParametersBuilder()
                .addLocalDate(BatchConfiguration.BUSINESS_DATE_PARAMETER, day, true)
                .addString(BatchConfiguration.SOURCE_PARAMETER, source, true)
                .toJobParameters();
        return batchOperator.findExecutions(BatchConfiguration.JOB_NAME, identity);
    }
}
