package io.adhar.service;

import com.adhar.kit.batch.AdharBatchApplication;
import io.adhar.service.batch.EnterpriseBatchProperties;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * A run-to-completion process: it starts, runs ONE job once and exits with the kit's exit
 * code (design 0025 §5.7), which the platform's Job failure policy reads. The kit's runner
 * ({@link AdharBatchApplication}) launches it from the run contract the BatchJob composition
 * sets on every run pod ({@code ADHAR_BATCH_JOB}, {@code ADHAR_BATCH_PARAMS}, ...): the
 * parameters completed and validated against the job's {@code @AdharBatchJob}, a failed day
 * restarted from its last commit and a completed one skipped. There is no web server and no
 * endpoint: on the platform every run is a Kubernetes Job the BatchJob composition creates from
 * {@code deploy/base/batchjob.yaml}, started by the schedule or by a person from the Console
 * or {@code adhar batch run}.
 */
@SpringBootApplication
@EnableConfigurationProperties(EnterpriseBatchProperties.class)
public class Application {

    public static void main(String[] args) {
        AdharBatchApplication.run(local(new SpringApplication(Application.class)), System::exit, args);
    }

    /**
     * A plain {@code mvn spring-boot:run} is one run of the sample job for today, exactly as a
     * pod runs it. Default properties sit below everything else, so the run contract the
     * platform sets on every run pod overrides them.
     */
    static SpringApplication local(SpringApplication application) {
        application.setDefaultProperties(Map.of(
                "ADHAR_BATCH_JOB", BatchConfiguration.JOB_BEAN,
                "ADHAR_BATCH_PARAMS", "{\"" + BatchConfiguration.BUSINESS_DATE_PARAMETER + "\":\"" + LocalDate.now() + "\"}"));
        return application;
    }
}
