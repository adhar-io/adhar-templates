package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.adhar.service.job.InputRecord;
import io.adhar.service.job.InvalidRecordException;
import io.adhar.service.job.OutputRecord;
import io.adhar.service.job.RecordProcessor;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class RecordProcessorTest {

    private static final LocalDate DAY = LocalDate.of(2026, 11, 3);

    private final RecordProcessor processor = new RecordProcessor(DAY);

    @Test
    void transformsTheRecordAndStampsTheBusinessDate() {
        assertThat(processor.process(new InputRecord(7, "  order-7 "))).isEqualTo(new OutputRecord(7, "ORDER_7", DAY));
    }

    @Test
    void refusesARecordNoRetryCanFix() {
        assertThatThrownBy(() -> processor.process(new InputRecord(8, "FAIL-8"))).isInstanceOf(InvalidRecordException.class)
                .hasMessageContaining("record 8");
        assertThatThrownBy(() -> processor.process(new InputRecord(9, " "))).isInstanceOf(InvalidRecordException.class);
        assertThatThrownBy(() -> processor.process(new InputRecord(10, null))).isInstanceOf(InvalidRecordException.class);
    }
}
