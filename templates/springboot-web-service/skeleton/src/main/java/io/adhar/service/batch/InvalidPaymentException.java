{%- if values.inServiceBatch %}
package io.adhar.service.batch;

/**
 * A payment that no retry can fix. The step skips it and writes it to the kit's dead-letter table
 * ({@code batch.ADHAR_BATCH_DEAD_LETTER}), so one bad row does not fail the day; past
 * {@code batch.skip-limit} skips the run fails, and is not retried.
 */
public class InvalidPaymentException extends RuntimeException {

    public InvalidPaymentException(String message) {
        super(message);
    }
}
{%- endif %}
