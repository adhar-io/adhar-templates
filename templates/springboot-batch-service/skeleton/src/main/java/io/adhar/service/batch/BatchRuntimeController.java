package io.adhar.service.batch;

import java.util.Map;
import java.util.Objects;
import org.springframework.batch.core.Job;
import org.springframework.batch.core.JobExecution;
import org.springframework.batch.core.JobParameter;
import org.springframework.batch.core.JobParameters;
import org.springframework.batch.core.JobParametersBuilder;
import org.springframework.batch.core.launch.JobLauncher;
import org.springframework.context.ApplicationContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/jobs")
public class BatchRuntimeController {

    private final ApplicationContext applicationContext;
    private final JobLauncher jobLauncher;
    private final EnterpriseBatchProperties batchProperties;

    public BatchRuntimeController(ApplicationContext applicationContext,
                                 JobLauncher jobLauncher,
                                 EnterpriseBatchProperties batchProperties) {
        this.applicationContext = applicationContext;
        this.jobLauncher = jobLauncher;
        this.batchProperties = batchProperties;
    }

    @PostMapping("/{jobName}/run")
    public ResponseEntity<Map<String, Object>> runJob(@PathVariable String jobName) throws Exception {
        Job job = applicationContext.getBean(jobName, Job.class);
        JobParameters params = new JobParametersBuilder()
                .addLong("run.id", System.currentTimeMillis())
                .addString("source", batchProperties.getInputType())
                .toJobParameters();

        JobExecution execution = jobLauncher.run(job, params);
        return ResponseEntity.accepted().body(Map.of(
                "jobName", jobName,
                "executionId", execution.getId(),
                "status", execution.getStatus().name(),
                "slaSeconds", batchProperties.getSlaSeconds()
        ));
    }
}
