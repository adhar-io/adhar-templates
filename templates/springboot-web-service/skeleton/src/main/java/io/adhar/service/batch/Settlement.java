{%- if values.inServiceBatch %}
package io.adhar.service.batch;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A row of {@code public.settlements}: one per settled payment, upserted on {@code payment_id}.
 *
 * @param paymentId    the payment's key
 * @param businessDate the day it was settled for
 * @param account      the account, normalised
 * @param amount       the amount, to the cent
 */
public record Settlement(long paymentId, LocalDate businessDate, String account, BigDecimal amount) {
}
{%- endif %}
