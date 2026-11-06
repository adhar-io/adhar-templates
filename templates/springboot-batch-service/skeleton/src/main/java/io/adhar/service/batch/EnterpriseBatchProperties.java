package io.adhar.service.batch;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "batch")
public class EnterpriseBatchProperties {

    private String inputType = "file";
    private String filePath = "data/input.txt";
    private String sql = "SELECT id, payload FROM batch_input ORDER BY id";
    private int chunkSize = 50;
    private int partitionCount = 4;
    private int retryLimit = 3;
    private long backoffMs = 2000L;
    private long slaSeconds = 900L;

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

    public String getSql() {
        return sql;
    }

    public void setSql(String sql) {
        this.sql = sql;
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

    public long getSlaSeconds() {
        return slaSeconds;
    }

    public void setSlaSeconds(long slaSeconds) {
        this.slaSeconds = slaSeconds;
    }
}
