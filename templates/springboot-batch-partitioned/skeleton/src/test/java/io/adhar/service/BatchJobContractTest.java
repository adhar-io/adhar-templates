package io.adhar.service;

import com.adhar.kit.test.batch.AdharBatchTest;
import com.adhar.kit.test.batch.BatchContractAssertions;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

/**
 * The contract between this code and {@code deploy/base/batchjob.yaml} (design 0025 §5.19): the
 * BatchJob declares exactly the parameters {@code @AdharBatchJob} declares on the job — every pod of a
 * run computes the run's identity from them, and the Console's form and {@code adhar batch run} check
 * against the manifest — its memory clears the JVM floor, and its grace period outlasts the kit's
 * graceful stop. A mismatch fails the build here instead of a run in production.
 */
@AdharBatchTest(properties = {
        // No collector on the test host: nothing to push to.
        "management.otlp.metrics.export.enabled=false",
        "adhar.tracing.open-telemetry.enabled=false",
})
class BatchJobContractTest {

    @Test
    void theManifestMatchesTheCode(@Autowired ApplicationContext context) {
        BatchContractAssertions.assertContract(context, BatchContractAssertions.DEFAULT_MANIFEST);
    }
}
