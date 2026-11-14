package io.adhar.service.job;

/**
 * A row of {@code public.batch_input}, mapped by column name.
 *
 * @param id      the key the manager splits the table on
 * @param payload the value this job transforms
 */
public record InputRecord(long id, String payload) {
}
