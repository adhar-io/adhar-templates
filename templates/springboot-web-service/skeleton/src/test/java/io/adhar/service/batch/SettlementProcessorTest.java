{%- if values.inServiceBatch %}
package io.adhar.service.batch;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.LocalDate;

import org.junit.jupiter.api.Test;

class SettlementProcessorTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 3);

    private final SettlementProcessor processor = new SettlementProcessor();

    @Test
    void settlesThePaymentNormalised() {
        assertThat(processor.process(new Payment(7, DAY, "  acc-7 ", new BigDecimal("12.345"))))
                .isEqualTo(new Settlement(7, DAY, "ACC-7", new BigDecimal("12.34")));
    }

    @Test
    void refusesAPaymentNoRetryCanFix() {
        assertThatThrownBy(() -> processor.process(new Payment(8, DAY, "acc-8", BigDecimal.ZERO)))
                .isInstanceOf(InvalidPaymentException.class).hasMessageContaining("payment 8");
        assertThatThrownBy(() -> processor.process(new Payment(9, DAY, "acc-9", new BigDecimal("-1"))))
                .isInstanceOf(InvalidPaymentException.class);
        assertThatThrownBy(() -> processor.process(new Payment(10, DAY, " ", BigDecimal.TEN)))
                .isInstanceOf(InvalidPaymentException.class);
        assertThatThrownBy(() -> processor.process(new Payment(11, DAY, null, BigDecimal.TEN)))
                .isInstanceOf(InvalidPaymentException.class);
        assertThatThrownBy(() -> processor.process(new Payment(12, DAY, "acc-12", null)))
                .isInstanceOf(InvalidPaymentException.class);
    }
}
{%- endif %}
