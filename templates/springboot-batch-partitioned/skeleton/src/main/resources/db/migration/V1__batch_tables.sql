-- The job's business tables, in schema public of its own database (Flyway; the kit
-- migrates schema batch - the JobRepository and the partition channel - itself).
--
-- batch_input is what the manager splits into key ranges: the key must be unique and
-- NOT NULL, because the partitioner's ranges and the readers' keyset paging both rest
-- on it. batch_output is upserted on the same key, so a chunk written twice is one row.
CREATE TABLE IF NOT EXISTS batch_input (
    id      BIGINT PRIMARY KEY,
    payload TEXT   NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_output (
    id            BIGINT PRIMARY KEY,
    payload       TEXT   NOT NULL,
    business_date DATE   NOT NULL
);
