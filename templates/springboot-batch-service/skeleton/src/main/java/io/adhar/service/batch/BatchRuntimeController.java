package io.adhar.service.batch;

import com.adhar.kit.batch.operator.BatchOperator;
import java.util.Map;
import org.springframework.batch.core.job.JobExecution;
import org.springframework.batch.core.job.parameters.JobParameters;
import org.springframework.batch.core.job.parameters.JobParametersBuilder;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * On-demand launches. {@code POST /api/jobs/{jobName}/run} starts the job named by its bean
 * name or job name ({@code enterpriseJob} or {@code enterprise-job}) through the kit's
 * {@link BatchOperator}, which also resolves the job and logs the run; {@code ?source=} picks
 * the input for that run ({@code file}, {@code database}, {@code list}).
 */
@RestController
@RequestMapping("/api/jobs")
public class BatchRuntimeController {

    private final BatchOperator batchOperator;
    private final EnterpriseBatchProperties batchProperties;

    public BatchRuntimeController(BatchOperator batchOperator, EnterpriseBatchProperties batchProperties) {
        this.batchOperator = batchOperator;
        this.batchProperties = batchProperties;
    }

    @PostMapping("/{jobName}/run")
    public ResponseEntity<Map<String, Object>> runJob(@PathVariable String jobName,
                                                      @RequestParam(required = false) String source) throws Exception {
        JobParameters params = new JobParametersBuilder()
                .addLong("run.id", System.currentTimeMillis())
                .addString("source", source != null && !source.isBlank() ? source : batchProperties.getInputType())
                .toJobParameters();

        JobExecution execution = batchOperator.start(jobName, params);
        return ResponseEntity.accepted().body(Map.of(
                "jobName", jobName,
                "executionId", execution.getId(),
                "status", execution.getStatus().name(),
                "slaSeconds", batchProperties.getSlaSeconds()
        ));
    }
}
