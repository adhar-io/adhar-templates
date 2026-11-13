package io.adhar.service.batch;

import com.adhar.kit.batch.fault.NonRetryableBatchException;
import com.adhar.kit.batch.operator.BatchOperator;
import com.adhar.kit.batch.operator.JobResolver;
import com.adhar.kit.batch.runtime.ExitCodes;
import io.adhar.service.BatchConfiguration;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.batch.core.BatchStatus;
import org.springframework.batch.core.job.Job;
import org.springframework.batch.core.job.JobExecution;
import org.springframework.batch.core.job.parameters.InvalidJobParametersException;
import org.springframework.batch.core.job.parameters.JobParameter;
import org.springframework.batch.core.job.parameters.JobParameters;
import org.springframework.batch.core.job.parameters.JobParametersBuilder;
import org.springframework.batch.core.launch.JobExecutionAlreadyRunningException;
import org.springframework.batch.core.launch.JobInstanceAlreadyCompleteException;
import org.springframework.batch.core.launch.JobRestartException;
import org.springframework.batch.core.step.StepExecution;
import org.springframework.batch.core.step.skip.SkipLimitExceededException;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ExitCodeGenerator;

/**
 * Launches the ONE run this process exists for, the way the platform launches it (design
 * 0025 §5.5): the job named by {@code ADHAR_BATCH_JOB}, with the parameters of
 * {@code ADHAR_BATCH_PARAMS} completed by the declared defaults and, for a scheduled run, the
 * business date of the scheduled time; then the kit's exit code (§5.7) and a termination
 * summary. The JobInstance's identity is the identifying parameters, so a failed night and
 * the person re-running that day address the SAME instance: Spring Batch restarts it from its
 * last commit instead of running it twice, and a day that completed is a no-op.
 *
 * <p>This is the application's own stand-in for the kit's Kubernetes runner; adhar-kit-batch
 * 0.1.0 ships the exit-code contract, the operator and the JDBC repository guard, not the
 * launcher itself. Keep it in step with {@code deploy/base/batchjob.yaml}: the parameters
 * declared there are the ones completed here.</p>
 *
 * <pre>
 * last execution of the identity   this run
 * none, FAILED, STOPPED            start (a restart resumes from the last commit)
 * COMPLETED                        exit 0, skipped: already complete
 * STARTED / STOPPING by a pod of   recover it (that pod is gone: Kubernetes replaced it), then start
 *   THIS Kubernetes Job
 * STARTED / STOPPING by another    exit 0, skipped: duplicate — recover it with `adhar batch`
 * ABANDONED                        exit 6: the day needs a new identity
 * UNKNOWN                          exit 7
 * </pre>
 */
public class PlatformRunLauncher implements ApplicationRunner, ExitCodeGenerator {

    private static final Logger log = LoggerFactory.getLogger(PlatformRunLauncher.class);

    /** Non-identifying provenance on every execution (design 0025 §5.6). */
    static final String TRIGGER_PARAMETER = "adhar.trigger";
    static final String K8S_JOB_PARAMETER = "adhar.k8s.job";
    static final String ACTOR_PARAMETER = "adhar.actor";

    /** Where the kubelet reads a container's termination message (≤ 4096 bytes). */
    static final Path TERMINATION_LOG = Path.of("/dev/termination-log");

    private final PlatformRun run;
    private final BatchOperator batchOperator;
    private final JobResolver jobResolver;
    private final EnterpriseBatchProperties properties;
    private final Clock clock;
    private final Path terminationLog;

    private volatile int exitCode = ExitCodes.STARTUP_FAILURE;
    private volatile String outcome = "not-started";

    public PlatformRunLauncher(PlatformRun run, BatchOperator batchOperator, JobResolver jobResolver,
                               EnterpriseBatchProperties properties, Clock clock) {
        this(run, batchOperator, jobResolver, properties, clock, TERMINATION_LOG);
    }

    /**
     * @param terminationLog where the termination summary is written when the file exists and is
     *                       writable (the kubelet's {@code /dev/termination-log} in a pod)
     */
    public PlatformRunLauncher(PlatformRun run, BatchOperator batchOperator, JobResolver jobResolver,
                               EnterpriseBatchProperties properties, Clock clock, Path terminationLog) {
        this.run = run;
        this.batchOperator = batchOperator;
        this.jobResolver = jobResolver;
        this.properties = properties;
        this.clock = clock;
        this.terminationLog = terminationLog;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        Job job;
        try {
            job = jobResolver.resolve(run.jobName());
        } catch (IllegalArgumentException ex) {
            throw new InvalidRunException(ex.getMessage(), ex);
        }
        JobParameters parameters = parameters();
        log.info("Run of job [{}] (BatchJob {}, trigger {}, Kubernetes Job {}) for {}", job.getName(),
                run.batchJobName(), run.trigger(), run.k8sJobName().isEmpty() ? "-" : run.k8sJobName(),
                parameters.getLocalDate(BatchConfiguration.BUSINESS_DATE_PARAMETER));

        Optional<JobExecution> last = batchOperator.findLastExecution(job.getName(), parameters);
        if (last.isPresent() && !mayStart(last.get())) {
            return;
        }
        JobExecution execution;
        try {
            execution = batchOperator.start(job, parameters);
        } catch (JobInstanceAlreadyCompleteException ex) {
            skip("already-complete", "this identity already completed: nothing to do");
            return;
        } catch (JobExecutionAlreadyRunningException ex) {
            skip("duplicate", "an execution of this identity is running elsewhere");
            return;
        } catch (JobRestartException | InvalidJobParametersException ex) {
            throw new InvalidRunException("the run cannot start: " + ex.getMessage(), ex);
        }
        finish(execution);
    }

    @Override
    public int getExitCode() {
        return exitCode;
    }

    /** @return what became of the run: completed, failed, stopped, skipped(reason), … */
    public String outcome() {
        return outcome;
    }

    /**
     * The identity of this run and its provenance: the given parameters completed by the
     * declared defaults (design 0025 §5.6, "explicit > schedule-derived > defaults").
     */
    JobParameters parameters() {
        Map<String, String> given = new LinkedHashMap<>(run.params());
        String source = given.remove(BatchConfiguration.SOURCE_PARAMETER);
        if (source == null || source.isBlank()) {
            source = properties.getInputType();
        }
        source = source.toLowerCase(Locale.ROOT);
        if (!BatchConfiguration.SOURCES.contains(source)) {
            throw new InvalidRunException("parameter 'source' must be one of " + BatchConfiguration.SOURCES
                    + ", was '" + source + "'");
        }
        JobParametersBuilder builder = new JobParametersBuilder()
                .addLocalDate(BatchConfiguration.BUSINESS_DATE_PARAMETER,
                        businessDate(given.remove(BatchConfiguration.BUSINESS_DATE_PARAMETER)), true)
                .addString(BatchConfiguration.SOURCE_PARAMETER, source, true);
        // Anything else the client sent is part of the identity too (the BatchJob's default).
        given.forEach((name, value) -> builder.addString(name, value, true));
        builder.addString(TRIGGER_PARAMETER, run.trigger(), false);
        if (!run.k8sJobName().isEmpty()) {
            builder.addString(K8S_JOB_PARAMETER, run.k8sJobName(), false);
        }
        if (!run.actor().isEmpty()) {
            builder.addString(ACTOR_PARAMETER, run.actor(), false);
        }
        return builder.toJobParameters();
    }

    /**
     * The day this run processes. Given explicitly, it is used as is. A scheduled run derives it
     * from the time the CronJob controller scheduled it — never from {@code now()}, so a 02:00
     * run that started late, or a replacement pod the next morning, keeps the night's identity.
     * Any other trigger (a person, a laptop) means today in the job's time zone, which is what
     * the Console's form and {@code adhar batch run} fill in when nobody says otherwise.
     */
    LocalDate businessDate(String given) {
        if (given != null && !given.isBlank()) {
            try {
                return LocalDate.parse(given.trim());
            } catch (DateTimeParseException ex) {
                throw new InvalidRunException("parameter 'businessDate' must be a date (yyyy-MM-dd), was '" + given + "'", ex);
            }
        }
        if (run.scheduled()) {
            return scheduledTime().atZone(run.zone()).toLocalDate();
        }
        return LocalDate.now(clock.withZone(run.zone()));
    }

    /**
     * The scheduled time of a run the CronJob controller created. It names each Job
     * {@code <cronjob>-<scheduled time in minutes since the epoch>} ({@code getJobName} in
     * kubernetes/pkg/controller/cronjob), which the downward API hands the pod as
     * {@code ADHAR_BATCH_K8S_JOB}; the controller also writes the same time as the Job's
     * {@code batch.kubernetes.io/cronjob-scheduled-timestamp} annotation, which would need a
     * request to the API server to read.
     */
    Instant scheduledTime() {
        String name = run.k8sJobName();
        int dash = name.lastIndexOf('-');
        String prefix = dash > 0 ? name.substring(0, dash) : "";
        String minutes = dash > 0 ? name.substring(dash + 1) : "";
        boolean ofThisCronJob = run.batchJobName().isEmpty() || prefix.equals(run.batchJobName());
        if (!ofThisCronJob || minutes.isEmpty() || !minutes.chars().allMatch(Character::isDigit)) {
            throw new InvalidRunException("a scheduled run with no scheduled time: ADHAR_BATCH_K8S_JOB '" + name
                    + "' is not '" + (run.batchJobName().isEmpty() ? "<cronjob>" : run.batchJobName())
                    + "-<minutes>' as the CronJob controller names its Jobs, and no businessDate was given");
        }
        return Instant.ofEpochSecond(Long.parseLong(minutes) * 60);
    }

    /** Decides from the identity's last execution whether this run starts; records the exit otherwise. */
    private boolean mayStart(JobExecution last) {
        BatchStatus status = last.getStatus();
        switch (status) {
            case COMPLETED -> {
                skip("already-complete", "execution " + last.getId() + " of this identity already completed");
                return false;
            }
            case ABANDONED -> {
                exitCode = ExitCodes.ABANDONED;
                outcome = "abandoned";
                log.error("Execution {} of this identity was ABANDONED: the day needs a new identity (exit {})",
                        last.getId(), exitCode);
                summary(last);
                return false;
            }
            case UNKNOWN -> {
                exitCode = ExitCodes.UNKNOWN;
                outcome = "unknown";
                log.error("Execution {} of this identity is in UNKNOWN state: inspect the repository (exit {})",
                        last.getId(), exitCode);
                summary(last);
                return false;
            }
            case STARTING, STARTED, STOPPING -> {
                String owner = last.getJobParameters().getString(K8S_JOB_PARAMETER);
                if (!run.k8sJobName().isEmpty() && run.k8sJobName().equals(owner)) {
                    // Our own previous pod: Kubernetes replaces a pod only once it is gone
                    // (podReplacementPolicy: Failed), so nothing else holds this execution.
                    log.warn("Execution {} is still {} from an earlier pod of this Kubernetes Job; recovering it "
                            + "and restarting from its last commit", last.getId(), status);
                    batchOperator.recover(last);
                    return true;
                }
                skip("duplicate", "execution " + last.getId() + " of this identity is " + status + " under "
                        + (owner == null ? "another process" : "Kubernetes Job " + owner)
                        + "; if that process is gone, recover it with `adhar batch`");
                return false;
            }
            default -> {
                return true;
            }
        }
    }

    private void skip(String reason, String why) {
        exitCode = ExitCodes.COMPLETED;
        outcome = "skipped(" + reason + ")";
        log.info("Run skipped ({}): {}", reason, why);
        writeTerminationLog(json(Map.of("v", 1, "job", run.jobName(), "batchJob", run.batchJobName(),
                "outcome", outcome, "exitCode", exitCode, "trigger", run.trigger())));
    }

    private void finish(JobExecution execution) {
        BatchStatus status = execution.getStatus();
        exitCode = switch (status) {
            case COMPLETED -> ExitCodes.COMPLETED;
            case FAILED -> nonRetryable(execution) ? ExitCodes.FAILED_NOT_RETRYABLE : ExitCodes.FAILED_RETRYABLE;
            case STOPPED -> ExitCodes.STOPPED;
            case ABANDONED -> ExitCodes.ABANDONED;
            // UNKNOWN, or a run still in flight when a synchronous operator returned: not an outcome.
            default -> ExitCodes.UNKNOWN;
        };
        outcome = status.name().toLowerCase(Locale.ROOT);
        if (exitCode == ExitCodes.COMPLETED) {
            log.info("Run completed: execution {} of job [{}] (exit {})", execution.getId(),
                    execution.getJobInstance().getJobName(), exitCode);
        } else {
            log.error("Run {}: execution {} of job [{}], exit {}{}", outcome, execution.getId(),
                    execution.getJobInstance().getJobName(), exitCode,
                    execution.getExitStatus().getExitDescription().isBlank() ? ""
                            : " - " + execution.getExitStatus().getExitDescription().lines().findFirst().orElse(""));
        }
        summary(execution);
    }

    /** A failure that would fail again on retry: the kit's exception, or the skip limit. */
    static boolean nonRetryable(JobExecution execution) {
        for (Throwable failure : execution.getAllFailureExceptions()) {
            for (Throwable t = failure; t != null; t = t.getCause() == t ? null : t.getCause()) {
                if (t instanceof NonRetryableBatchException || t instanceof SkipLimitExceededException) {
                    return true;
                }
            }
        }
        return false;
    }

    /** The termination summary (design 0025 §5.13): one line in the log and the container's termination message. */
    private void summary(JobExecution execution) {
        long read = 0;
        long written = 0;
        long skipped = 0;
        long filtered = 0;
        StringBuilder steps = new StringBuilder("[");
        for (StepExecution step : execution.getStepExecutions()) {
            read += step.getReadCount();
            written += step.getWriteCount();
            skipped += step.getSkipCount();
            filtered += step.getFilterCount();
            if (steps.length() > 1) {
                steps.append(',');
            }
            steps.append(json(Map.of("name", step.getStepName(), "status", step.getStatus().name(),
                    "read", step.getReadCount(), "written", step.getWriteCount(), "skipped", step.getSkipCount())));
        }
        steps.append(']');
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("v", 1);
        fields.put("job", execution.getJobInstance().getJobName());
        fields.put("batchJob", run.batchJobName());
        fields.put("instanceId", execution.getJobInstance().getInstanceId());
        fields.put("executionId", execution.getId());
        fields.put("status", execution.getStatus().name());
        fields.put("exitCode", exitCode);
        fields.put("exitDescription", execution.getExitStatus().getExitDescription().lines().findFirst().orElse(""));
        fields.put("outcome", outcome);
        fields.put("trigger", run.trigger());
        JobParameter<?> date = execution.getJobParameters().getParameter(BatchConfiguration.BUSINESS_DATE_PARAMETER);
        fields.put("businessDate", date == null ? "" : String.valueOf(date.value()));
        fields.put("read", read);
        fields.put("written", written);
        fields.put("skipped", skipped);
        fields.put("filtered", filtered);
        fields.put("start", iso(execution.getStartTime()));
        fields.put("end", iso(execution.getEndTime()));
        String summary = json(fields);
        // The steps are detail: they go last, and only while the kubelet's 4096-byte limit allows.
        String withSteps = summary.substring(0, summary.length() - 1) + ",\"steps\":" + steps + "}";
        String message = withSteps.getBytes(StandardCharsets.UTF_8).length <= 3500 ? withSteps : summary;
        log.info("Run summary {}", message);
        writeTerminationLog(message);
    }

    private void writeTerminationLog(String message) {
        if (!Files.isWritable(terminationLog)) {
            return;
        }
        try {
            Files.writeString(terminationLog, message, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            log.debug("Could not write the termination message to {}: {}", terminationLog, ex.getMessage());
        }
    }

    private static String iso(LocalDateTime time) {
        return time == null ? "" : time.atOffset(ZoneOffset.UTC).toInstant().toString();
    }

    /** A flat JSON object of strings and numbers; nothing here needs more than that. */
    static String json(Map<String, ?> fields) {
        StringBuilder out = new StringBuilder("{");
        fields.forEach((key, value) -> {
            if (out.length() > 1) {
                out.append(',');
            }
            out.append('"').append(escape(key)).append("\":");
            if (value instanceof Number) {
                out.append(value);
            } else {
                out.append('"').append(escape(String.valueOf(value))).append('"');
            }
        });
        return out.append('}').toString();
    }

    private static String escape(String s) {
        StringBuilder out = new StringBuilder(s.length());
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.toString();
    }
}
