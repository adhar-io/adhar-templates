{%- if values.inServiceBatch %}
package io.adhar.service.batch;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A row of {@code public.payments}, mapped by column name.
 *
 * @param id           the key the reader pages on
 * @param businessDate the day the payment belongs to
 * @param account      the account it is for, as received
 * @param amount       the amount, as received
 */
public record Payment(long id, LocalDate businessDate, String account, BigDecimal amount) {
}
{%- endif %}
