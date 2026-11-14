package io.adhar.service;

import com.adhar.kit.batch.AdharBatchApplication;
import io.adhar.service.job.ImportJobConfiguration;
import java.time.LocalDate;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * A run-to-completion process, and the same image for every pod of a run: the manager and each
 * worker start here, and the kit's runner ({@link AdharBatchApplication}) reads which part this
 * pod plays from the environment the BatchJob composition sets ({@code ADHAR_BATCH_ROLE},
 * {@code ADHAR_BATCH_PARTITION_*}, design 0025 §5.10). The manager runs the job and exits with
 * the kit's exit code (§5.7); a worker serves partitions until the run is over. There is no web
 * server and no endpoint.
 */
@SpringBootApplication
public class Application {

    public static void main(String[] args) {
        AdharBatchApplication.run(local(new SpringApplication(Application.class)), System::exit, args);
    }

    /**
     * A plain {@code mvn spring-boot:run} is one run of the job for today in role {@code single}
     * (the manager and its partitions in this one process), exactly as a pod runs it otherwise.
     * Default properties sit below everything else, so the run contract the platform sets on
     * every pod ({@code ADHAR_BATCH_JOB}, {@code ADHAR_BATCH_PARAMS}, …) overrides them.
     */
    static SpringApplication local(SpringApplication application) {
        application.setDefaultProperties(Map.of(
                "ADHAR_BATCH_JOB", ImportJobConfiguration.JOB,
                "ADHAR_BATCH_PARAMS", "{\"" + ImportJobConfiguration.BUSINESS_DATE + "\":\"" + LocalDate.now() + "\"}"));
        return application;
    }
}
