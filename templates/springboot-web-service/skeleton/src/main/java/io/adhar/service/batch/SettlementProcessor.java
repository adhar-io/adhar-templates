{%- if values.inServiceBatch %}
package io.adhar.service.batch;

import java.math.RoundingMode;
import java.util.Locale;

import org.springframework.batch.infrastructure.item.ItemProcessor;

/**
 * The business logic of one payment: replace it with the real settlement. It runs once per payment,
 * inside the chunk's transaction, so it must have no side effects beyond the item it returns: a chunk
 * that is retried, or a run restarted from its last commit, processes its payments again.
 */
public class SettlementProcessor implements ItemProcessor<Payment, Settlement> {

    /**
     * @throws InvalidPaymentException for a payment with no account or an amount that is not positive
     */
    @Override
    public Settlement process(Payment payment) {
        String account = payment.account() == null ? "" : payment.account().trim();
        if (account.isEmpty() || payment.amount() == null || payment.amount().signum() <= 0) {
            throw new InvalidPaymentException("payment " + payment.id() + " cannot be settled: account '" + account
                    + "', amount " + payment.amount());
        }
        return new Settlement(payment.id(), payment.businessDate(), account.toUpperCase(Locale.ROOT),
                payment.amount().setScale(2, RoundingMode.HALF_EVEN));
    }
}
{%- endif %}
