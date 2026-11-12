package io.adhar.service.batch;

import org.springframework.batch.infrastructure.item.ExecutionContext;
import org.springframework.batch.infrastructure.item.ItemReader;
import org.springframework.batch.infrastructure.item.ItemStream;
import org.springframework.batch.infrastructure.item.ItemStreamException;
import org.springframework.batch.infrastructure.item.ItemStreamReader;

/**
 * Hands one partition its share of a sequential input: of the items the delegate yields,
 * every {@code partitionCount}-th one starting at {@code partitionIndex}. It is what lets a
 * file or an in-memory list be read by several partitions without any of them seeing an
 * item twice. Position is saved with the step's execution context, so a restarted partition
 * resumes where its delegate does.
 *
 * @param <T> the item type
 */
public final class PartitionSliceReader<T> implements ItemStreamReader<T> {

    private final String name;
    private final ItemReader<? extends T> delegate;
    private final int partitionIndex;
    private final int partitionCount;
    private long seen;

    public PartitionSliceReader(String name, ItemReader<? extends T> delegate, int partitionIndex, int partitionCount) {
        if (partitionCount < 1 || partitionIndex < 0 || partitionIndex >= partitionCount) {
            throw new IllegalArgumentException("partition " + partitionIndex + " of " + partitionCount + " is not a slice");
        }
        this.name = name;
        this.delegate = delegate;
        this.partitionIndex = partitionIndex;
        this.partitionCount = partitionCount;
    }

    @Override
    public T read() throws Exception {
        T item;
        while ((item = delegate.read()) != null) {
            long position = seen++;
            if (position % partitionCount == partitionIndex) {
                return item;
            }
        }
        return null;
    }

    @Override
    public void open(ExecutionContext executionContext) throws ItemStreamException {
        if (delegate instanceof ItemStream stream) {
            stream.open(executionContext);
        }
        seen = executionContext.getLong(positionKey(), 0L);
    }

    @Override
    public void update(ExecutionContext executionContext) throws ItemStreamException {
        if (delegate instanceof ItemStream stream) {
            stream.update(executionContext);
        }
        executionContext.putLong(positionKey(), seen);
    }

    @Override
    public void close() throws ItemStreamException {
        if (delegate instanceof ItemStream stream) {
            stream.close();
        }
    }

    private String positionKey() {
        return name + ".seen";
    }
}
