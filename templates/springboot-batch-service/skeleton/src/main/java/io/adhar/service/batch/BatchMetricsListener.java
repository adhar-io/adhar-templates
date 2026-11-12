package io.adhar.service.batch;

import com.adhar.kit.batch.listener.BatchRunObserver;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import java.time.Duration;
import java.time.LocalDateTime;
import org.springframework.batch.core.job.JobExecution;
import org.springframework.batch.core.step.StepExecution;
import org.springframework.stereotype.Component;

/**
 * The service's own batch meters. adhar-kit-batch attaches its listeners to every job and
 * step bean and notifies each {@link BatchRunObserver} of the run, so this needs no wiring
 * of its own: being a bean is enough. The kit's {@code adhar.batch.run} and
 * {@code adhar.batch.last.commit} meters are published alongside.
 */
@Component
public class BatchMetricsListener implements BatchRunObserver {

    private final MeterRegistry meterRegistry;

    public BatchMetricsListener(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @Override
    public void jobStarted(JobExecution jobExecution) {
        meterRegistry.counter("batch.job.start", Tags.of("job", jobExecution.getJobInstance().getJobName())).increment();
    }

    @Override
    public void jobFinished(JobExecution jobExecution) {
        String jobName = jobExecution.getJobInstance().getJobName();
        meterRegistry.counter("batch.job.finish",
                Tags.of("job", jobName, "status", jobExecution.getStatus().name())).increment();
        long durationMs = millisBetween(jobExecution.getStartTime(), jobExecution.getEndTime());
        if (durationMs >= 0) {
            meterRegistry.summary("batch.job.duration.ms", "job", jobName).record(durationMs);
        }
    }

    @Override
    public void stepStarted(StepExecution stepExecution) {
        meterRegistry.counter("batch.step.start", Tags.of("step", stepExecution.getStepName())).increment();
    }

    @Override
    public void stepFinished(StepExecution stepExecution) {
        meterRegistry.counter("batch.step.finish",
                Tags.of("step", stepExecution.getStepName(), "status", stepExecution.getStatus().name())).increment();
        meterRegistry.counter("batch.step.items.read", Tags.of("step", stepExecution.getStepName()))
                .increment(stepExecution.getReadCount());
        meterRegistry.counter("batch.step.items.written", Tags.of("step", stepExecution.getStepName()))
                .increment(stepExecution.getWriteCount());
    }

    @Override
    public void chunkCommitted(StepExecution stepExecution, long items) {
        meterRegistry.counter("batch.chunk.commit", Tags.of("step", stepExecution.getStepName())).increment();
    }

    /** Spring Batch 6 reports times as {@link LocalDateTime}; the end time is null while a run is in flight. */
    private static long millisBetween(LocalDateTime start, LocalDateTime end) {
        if (start == null || end == null) {
            return -1L;
        }
        return Duration.between(start, end).toMillis();
    }
}
