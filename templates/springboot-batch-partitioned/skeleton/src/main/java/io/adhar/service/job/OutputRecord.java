package io.adhar.service.job;

import java.time.LocalDate;

/**
 * A row of {@code public.batch_output}, written by an upsert on {@code id} (column {@code business_date}
 * binds the property {@code businessDate}).
 *
 * @param id           the input row's key
 * @param payload      the transformed value
 * @param businessDate the day of the run that wrote it
 */
public record OutputRecord(long id, String payload, LocalDate businessDate) {
}
