package io.adhar.service.job;

import java.time.LocalDate;
import java.util.Locale;
import java.util.Objects;
import org.springframework.batch.infrastructure.item.ItemProcessor;

/**
 * The business logic of one record: replace it with the real transformation. It runs in the worker
 * pods only, once per record, inside the chunk's transaction — so it must not have side effects of its
 * own beyond the item it returns: a chunk that is retried, or a partition that is restarted from its
 * last commit, processes its records again.
 */
public class RecordProcessor implements ItemProcessor<InputRecord, OutputRecord> {

    private final LocalDate businessDate;

    /**
     * @param businessDate the run's business date, stamped on every record
     */
    public RecordProcessor(LocalDate businessDate) {
        this.businessDate = Objects.requireNonNull(businessDate, "businessDate");
    }

    /**
     * @throws InvalidRecordException for an empty payload or one that says FAIL (the sample's poison pill)
     */
    @Override
    public OutputRecord process(InputRecord item) {
        String payload = item.payload() == null ? "" : item.payload().trim();
        if (payload.isEmpty() || payload.contains("FAIL")) {
            throw new InvalidRecordException("record " + item.id() + " cannot be imported: '" + payload + "'");
        }
        return new OutputRecord(item.id(), payload.toUpperCase(Locale.ROOT).replace('-', '_'), businessDate);
    }
}
