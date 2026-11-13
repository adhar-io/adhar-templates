package io.adhar.service;

import io.adhar.service.batch.EnterpriseBatchProperties;
import io.adhar.service.batch.PlatformRun;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * A run-to-completion process: it starts, runs ONE job once and exits with the kit's exit
 * code (design 0025 §5.7), which the platform's Job failure policy reads. There is no web
 * server and no endpoint: on the platform every run is a Kubernetes Job the BatchJob
 * composition creates from {@code deploy/base/batchjob.yaml}, started by the schedule or by a
 * person from the Console or {@code adhar batch run}.
 */
@SpringBootApplication
@EnableConfigurationProperties(EnterpriseBatchProperties.class)
public class Application {

    public static void main(String[] args) {
        SpringApplication app = new SpringApplication(Application.class);
        // A plain `mvn spring-boot:run` is one run of the sample job for today, exactly as a
        // pod runs it. Default properties sit below everything else, so the run contract the
        // platform sets on every run pod (ADHAR_BATCH_JOB and friends) overrides them.
        app.setDefaultProperties(Map.of(PlatformRun.JOB, BatchConfiguration.JOB_BEAN, PlatformRun.TRIGGER, "local"));
        // The exit code is the launcher's (an ExitCodeGenerator); a failure before the run
        // (bean creation, no database) leaves Spring Boot's own code, 1 — or 2 for the kit's
        // in-memory-repository refusal and the launcher's invalid-request exceptions.
        System.exit(SpringApplication.exit(app.run(args)));
    }
}
