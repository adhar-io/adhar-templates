package io.adhar.service.job;

/**
 * A record that no retry can fix. The worker step skips it and writes it to the kit's dead-letter
 * table ({@code batch.ADHAR_BATCH_DEAD_LETTER}), so one bad row does not fail its partition; past
 * {@code batch.skip-limit} skips the partition fails, not retryable (exit 3).
 */
public class InvalidRecordException extends RuntimeException {

    public InvalidRecordException(String message) {
        super(message);
    }
}
