package io.adhar.service.batch;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import org.springframework.batch.core.JobExecution;
import org.springframework.batch.core.JobExecutionListener;
import org.springframework.batch.core.StepExecution;
import org.springframework.batch.core.StepExecutionListener;
import org.springframework.stereotype.Component;

@Component
public class BatchMetricsListener implements JobExecutionListener, StepExecutionListener {

    private final MeterRegistry meterRegistry;

    public BatchMetricsListener(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }

    @Override
    public void beforeJob(JobExecution jobExecution) {
        meterRegistry.counter("batch.job.start", Tags.of("job", jobExecution.getJobInstance().getJobName())).increment();
    }

    @Override
    public void afterJob(JobExecution jobExecution) {
        String jobName = jobExecution.getJobInstance().getJobName();
        meterRegistry.counter("batch.job.finish",
                Tags.of("job", jobName, "status", jobExecution.getStatus().name())).increment();

        if (jobExecution.getStartTime() != null && jobExecution.getEndTime() != null) {
            long durationMs = jobExecution.getEndTime().getTime() - jobExecution.getStartTime().getTime();
            meterRegistry.summary("batch.job.duration.ms", "job", jobName).record(durationMs);
        }
    }

    @Override
    public void beforeStep(StepExecution stepExecution) {
        meterRegistry.counter("batch.step.start", Tags.of("step", stepExecution.getStepName())).increment();
    }

    @Override
    public void afterStep(StepExecution stepExecution) {
        meterRegistry.counter("batch.step.finish",
                Tags.of("step", stepExecution.getStepName(), "status", stepExecution.getStatus().name())).increment();
    }
}
