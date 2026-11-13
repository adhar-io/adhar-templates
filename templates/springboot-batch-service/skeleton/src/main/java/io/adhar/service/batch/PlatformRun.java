package io.adhar.service.batch;

import java.time.DateTimeException;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.json.BasicJsonParser;
import org.springframework.core.env.Environment;

/**
 * What the platform tells a run about itself: the runner contract every run pod carries as
 * environment (design 0025 §5.5, set by the BatchJob composition from
 * {@code deploy/base/batchjob.yaml}, or by the Console / {@code adhar batch run} from the run
 * template). Read through Spring's {@link Environment}, so {@code ADHAR_BATCH_JOB} and the
 * property {@code adhar.batch.job} are the same thing — a laptop sets the property, a pod the
 * variable.
 *
 * @param jobName      the Spring Batch job's bean name or job name ({@code ADHAR_BATCH_JOB})
 * @param batchJobName the BatchJob this run belongs to ({@code ADHAR_BATCH_NAME}); also the
 *                     name of the CronJob a scheduled run was created by
 * @param trigger      {@code schedule}, {@code manual}, {@code restart}, … ({@code ADHAR_BATCH_TRIGGER});
 *                     {@code local} outside the platform
 * @param actor        who started a manual run ({@code ADHAR_BATCH_ACTOR}); empty for the schedule
 * @param k8sJobName   the Kubernetes Job of this run ({@code ADHAR_BATCH_K8S_JOB}); empty off the platform
 * @param zone         the job's time zone ({@code ADHAR_BATCH_TIME_ZONE}): the schedule's and the business date's
 * @param params       the parameters the run was given ({@code ADHAR_BATCH_PARAMS}, a JSON object
 *                     of strings); {@code {}} for a scheduled run, which derives its business date
 */
public record PlatformRun(String jobName, String batchJobName, String trigger, String actor, String k8sJobName,
                          ZoneId zone, Map<String, String> params) {

    /** {@code ADHAR_BATCH_JOB}: what to run. The platform sets it on every run pod. */
    public static final String JOB = "adhar.batch.job";
    /** {@code ADHAR_BATCH_NAME}: the BatchJob's name. */
    public static final String NAME = "adhar.batch.name";
    /** {@code ADHAR_BATCH_TRIGGER}: what started the run. */
    public static final String TRIGGER = "adhar.batch.trigger";
    /** {@code ADHAR_BATCH_ACTOR}: who started it (stamped on manual runs). */
    public static final String ACTOR = "adhar.batch.actor";
    /** {@code ADHAR_BATCH_K8S_JOB}: the Kubernetes Job's name, from the downward API. */
    public static final String K8S_JOB = "adhar.batch.k8s-job";
    /** {@code ADHAR_BATCH_TIME_ZONE}: the IANA zone of the schedule and the business date. */
    public static final String TIME_ZONE = "adhar.batch.time-zone";
    /** {@code ADHAR_BATCH_PARAMS}: the run's parameters as a JSON object. */
    public static final String PARAMS = "adhar.batch.params";

    /** The trigger of a run the CronJob controller started. */
    public static final String SCHEDULE_TRIGGER = "schedule";

    public PlatformRun {
        if (jobName == null || jobName.isBlank()) {
            throw new InvalidRunException("no job to run: ADHAR_BATCH_JOB (adhar.batch.job) is not set");
        }
        batchJobName = batchJobName == null ? "" : batchJobName;
        trigger = trigger == null || trigger.isBlank() ? "local" : trigger;
        actor = actor == null ? "" : actor;
        k8sJobName = k8sJobName == null ? "" : k8sJobName;
        zone = zone == null ? ZoneId.of("UTC") : zone;
        params = params == null ? Map.of() : Map.copyOf(params);
    }

    /**
     * @param environment the application's environment
     * @return the run it describes
     * @throws InvalidRunException when the contract is unreadable: no job, a bad zone, parameters
     *                             that are not a JSON object of strings (exit code 2, never a retry)
     */
    public static PlatformRun fromEnvironment(Environment environment) {
        ZoneId zone;
        String zoneName = environment.getProperty(TIME_ZONE, "UTC");
        try {
            zone = ZoneId.of(zoneName.isBlank() ? "UTC" : zoneName);
        } catch (DateTimeException ex) {
            throw new InvalidRunException("ADHAR_BATCH_TIME_ZONE '" + zoneName + "' is not an IANA time zone", ex);
        }
        return new PlatformRun(environment.getProperty(JOB), environment.getProperty(NAME),
                environment.getProperty(TRIGGER), environment.getProperty(ACTOR), environment.getProperty(K8S_JOB),
                zone, parseParams(environment.getProperty(PARAMS, "{}")));
    }

    /**
     * @param json the value of {@code ADHAR_BATCH_PARAMS}
     * @return its entries, every value as the string the client sent
     */
    static Map<String, String> parseParams(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        Map<String, Object> raw;
        try {
            raw = new BasicJsonParser().parseMap(json);
        } catch (RuntimeException ex) {
            throw new InvalidRunException("ADHAR_BATCH_PARAMS is not a JSON object: " + json, ex);
        }
        Map<String, String> params = new LinkedHashMap<>();
        raw.forEach((name, value) -> {
            if (value == null) {
                return;
            }
            if (value instanceof Map || value instanceof Iterable) {
                throw new InvalidRunException("parameter '" + name + "' must be a string, not " + value);
            }
            params.put(name, String.valueOf(value));
        });
        return params;
    }

    /** @return whether the CronJob controller started this run */
    public boolean scheduled() {
        return SCHEDULE_TRIGGER.equals(trigger);
    }
}
