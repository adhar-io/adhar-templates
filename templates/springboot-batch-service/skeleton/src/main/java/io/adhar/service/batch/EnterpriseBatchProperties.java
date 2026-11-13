package io.adhar.service.batch;

import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The knobs of the sample job ({@code batch.*}). The kit's own settings
 * ({@code adhar.batch.*}: repository schema, retry back-off defaults, the shutdown timeout)
 * are separate and documented in adhar-kit-batch; the platform's run contract
 * ({@code ADHAR_BATCH_*}) is read by {@link PlatformRun}. A run's duration budget is not here
 * either: it is {@code sla.maxDuration} on the BatchJob, which the platform alerts on.
 */
@ConfigurationProperties(prefix = "batch")
public class EnterpriseBatchProperties {

    /**
     * Where the job reads from when a run names no {@code source}: {@code file},
     * {@code database} or {@code list}. Must equal the parameter's {@code default} in
     * {@code deploy/base/batchjob.yaml}, or a scheduled run and a manual run of the same day
     * would be two JobInstances instead of one.
     */
    private String inputType = "file";

    /** Classpath location of the input file, one item per line. */
    private String filePath = "data/input.txt";

    /** Table read by the {@code database} input. */
    private String table = "batch_input";

    /** Numeric key the {@code database} input is ordered and partitioned by. */
    private String keyColumn = "id";

    /** Column whose value becomes the item of the {@code database} input. */
    private String payloadColumn = "payload";

    /** Items of the {@code list} input (handy for smoke tests and demos). */
    private List<String> items = new ArrayList<>();

    private int chunkSize = 50;
    private int partitionCount = 4;
    private int retryLimit = 3;
    private long backoffMs = 2000L;

    public String getInputType() {
        return inputType;
    }

    public void setInputType(String inputType) {
        this.inputType = inputType;
    }

    public String getFilePath() {
        return filePath;
    }

    public void setFilePath(String filePath) {
        this.filePath = filePath;
    }

    public String getTable() {
        return table;
    }

    public void setTable(String table) {
        this.table = table;
    }

    public String getKeyColumn() {
        return keyColumn;
    }

    public void setKeyColumn(String keyColumn) {
        this.keyColumn = keyColumn;
    }

    public String getPayloadColumn() {
        return payloadColumn;
    }

    public void setPayloadColumn(String payloadColumn) {
        this.payloadColumn = payloadColumn;
    }

    public List<String> getItems() {
        return items;
    }

    public void setItems(List<String> items) {
        this.items = items;
    }

    public int getChunkSize() {
        return chunkSize;
    }

    public void setChunkSize(int chunkSize) {
        this.chunkSize = chunkSize;
    }

    public int getPartitionCount() {
        return partitionCount;
    }

    public void setPartitionCount(int partitionCount) {
        this.partitionCount = partitionCount;
    }

    public int getRetryLimit() {
        return retryLimit;
    }

    public void setRetryLimit(int retryLimit) {
        this.retryLimit = retryLimit;
    }

    public long getBackoffMs() {
        return backoffMs;
    }

    public void setBackoffMs(long backoffMs) {
        this.backoffMs = backoffMs;
    }
}
