package io.adhar.service;

import com.adhar.kit.batch.fault.FaultTolerance;
import com.adhar.kit.batch.operator.BatchOperator;
import com.adhar.kit.batch.step.AdharSteps;
import io.adhar.service.batch.EnterpriseBatchProperties;
import io.adhar.service.batch.PartitionSliceReader;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.batch.core.configuration.annotation.StepScope;
import org.springframework.batch.core.job.Job;
import org.springframework.batch.core.job.builder.JobBuilder;
import org.springframework.batch.core.job.parameters.JobParametersBuilder;
import org.springframework.batch.core.partition.Partitioner;
import org.springframework.batch.core.repository.JobRepository;
import org.springframework.batch.core.step.Step;
import org.springframework.batch.infrastructure.item.ExecutionContext;
import org.springframework.batch.infrastructure.item.ItemProcessor;
import org.springframework.batch.infrastructure.item.ItemStreamReader;
import org.springframework.batch.infrastructure.item.ItemWriter;
import org.springframework.batch.infrastructure.item.database.Order;
import org.springframework.batch.infrastructure.item.database.builder.JdbcPagingItemReaderBuilder;
import org.springframework.batch.infrastructure.item.file.FlatFileItemReader;
import org.springframework.batch.infrastructure.item.file.builder.FlatFileItemReaderBuilder;
import org.springframework.batch.infrastructure.item.file.mapping.PassThroughLineMapper;
import org.springframework.batch.infrastructure.item.support.ListItemReader;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.task.SimpleAsyncTaskExecutor;

/**
 * The sample job, on Spring Batch 6 through adhar-kit-batch: a manager step partitions the
 * input into {@code batch.partition-count} slices that run concurrently, each a chunk-oriented
 * worker step reading its slice, transforming every item and writing it out. The kit's
 * {@link AdharSteps} builds the steps on the JobRepository's transaction manager with the
 * platform's listeners attached, and {@link FaultTolerance} declares what is retried.
 *
 * <p>There is no {@code @EnableBatchProcessing}: on Spring Boot it switches the batch
 * auto-configuration (and with it the kit's) OFF.</p>
 */
@Configuration(proxyBeanMethods = false)
public class BatchConfiguration {

    private static final Logger log = LoggerFactory.getLogger(BatchConfiguration.class);

    public static final String JOB_NAME = "enterprise-job";
    public static final String WORKER_STEP = "workerStep";
    public static final String MANAGER_STEP = "managerStep";
    /** Job parameter choosing the input of one run; defaults to {@code batch.input-type}. */
    public static final String SOURCE_PARAMETER = "source";
    static final String PARTITION_INDEX = "partitionIndex";
    static final String PARTITION_COUNT = "partitionCount";

    /**
     * One reader per partition (step scope): the partition's index and count come from the
     * execution context the {@link #partitioner} wrote, the input from the run's
     * {@code source} parameter or the configured default.
     */
    @Bean
    @StepScope
    public ItemStreamReader<String> batchReader(
            @Value("#{jobParameters['" + SOURCE_PARAMETER + "']}") String source,
            @Value("#{stepExecutionContext['" + PARTITION_INDEX + "'] ?: 0}") int partitionIndex,
            @Value("#{stepExecutionContext['" + PARTITION_COUNT + "'] ?: 1}") int partitionCount,
            ObjectProvider<DataSource> dataSource,
            EnterpriseBatchProperties properties) throws Exception {
        String inputType = source != null && !source.isBlank() ? source : properties.getInputType();
        return switch (inputType.toLowerCase(Locale.ROOT)) {
            case "database" -> databaseReader(dataSource.getObject(), partitionIndex, partitionCount, properties);
            case "list" -> new PartitionSliceReader<>("listBatchReader",
                    new ListItemReader<>(List.copyOf(properties.getItems())), partitionIndex, partitionCount);
            case "file" -> {
                FlatFileItemReader<String> lines = new FlatFileItemReaderBuilder<String>()
                        .name("fileBatchReader")
                        .resource(new ClassPathResource(properties.getFilePath()))
                        .lineMapper(new PassThroughLineMapper())
                        .build();
                yield new PartitionSliceReader<>("fileBatchReader", lines, partitionIndex, partitionCount);
            }
            default -> throw new IllegalArgumentException(
                    "batch.input-type / job parameter 'source' must be file, database or list, was '" + inputType + "'");
        };
    }

    /**
     * Pages the table in key order; each partition takes the rows whose key hashes to it. The
     * key is selected along with the payload because the paging reader reads it back from
     * every page to position the next one.
     */
    private static ItemStreamReader<String> databaseReader(DataSource dataSource, int partitionIndex,
                                                            int partitionCount,
                                                            EnterpriseBatchProperties properties) throws Exception {
        String key = properties.getKeyColumn();
        String payload = properties.getPayloadColumn();
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put(PARTITION_COUNT, partitionCount);
        parameters.put(PARTITION_INDEX, partitionIndex);
        return new JdbcPagingItemReaderBuilder<String>()
                .name("databaseBatchReader")
                .dataSource(dataSource)
                .selectClause("SELECT " + key + ", " + payload)
                .fromClause("FROM " + properties.getTable())
                .whereClause("MOD(" + key + ", :" + PARTITION_COUNT + ") = :" + PARTITION_INDEX)
                .parameterValues(parameters)
                .sortKeys(Map.of(key, Order.ASCENDING))
                .rowMapper((rs, rowNum) -> rs.getString(payload))
                .pageSize(properties.getChunkSize())
                .fetchSize(properties.getChunkSize())
                .build();
    }

    @Bean
    public ItemProcessor<String, String> itemProcessor() {
        return item -> {
            String value = item.trim();
            if (value.contains("FAIL")) {
                throw new IllegalStateException("Synthetic failure for value: " + value);
            }
            return value.toUpperCase(Locale.ROOT).replace('-', '_');
        };
    }

    @Bean
    public ItemWriter<String> itemWriter() {
        return items -> items.forEach(item -> log.info("Processed batch item: {}", item));
    }

    /**
     * Index-based partitions: {@code partitionIndex} of {@code partitionCount}, which every
     * input type can slice. For keyed ranges (ids 1..N) the kit's
     * {@code AdharRangePartitioner} is the alternative.
     */
    @Bean
    public Partitioner partitioner(EnterpriseBatchProperties properties) {
        return gridSize -> {
            int count = Math.max(1, Math.min(gridSize, properties.getPartitionCount()));
            Map<String, ExecutionContext> partitions = new LinkedHashMap<>();
            for (int i = 0; i < count; i++) {
                ExecutionContext context = new ExecutionContext();
                context.putInt(PARTITION_INDEX, i);
                context.putInt(PARTITION_COUNT, count);
                partitions.put("partition" + i, context);
            }
            return partitions;
        };
    }

    /**
     * The chunk-oriented worker. Transient infrastructure failures and the sample's own
     * {@link IllegalStateException} are retried {@code batch.retry-limit} times with a fixed
     * {@code batch.backoff-ms} delay; an item still failing after that fails the partition.
     */
    @Bean
    public Step workerStep(AdharSteps steps,
                           ItemStreamReader<String> batchReader,
                           ItemProcessor<String, String> itemProcessor,
                           ItemWriter<String> itemWriter,
                           EnterpriseBatchProperties properties) {
        Duration backoff = Duration.ofMillis(Math.max(1L, properties.getBackoffMs()));
        return steps.<String, String>chunk(WORKER_STEP, properties.getChunkSize())
                .reader(batchReader)
                .processor(itemProcessor)
                .writer(itemWriter)
                .faultTolerance(FaultTolerance.transientInfrastructure()
                        .alsoRetryOn(IllegalStateException.class)
                        .maxAttempts(Math.max(1, properties.getRetryLimit()))
                        .backoff(backoff, backoff))
                .build();
    }

    /** Runs the worker once per partition, concurrently, and aggregates their outcome. */
    @Bean
    public Step managerStep(AdharSteps steps, Step workerStep, Partitioner partitioner,
                            EnterpriseBatchProperties properties) {
        int partitions = Math.max(1, properties.getPartitionCount());
        SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("batch-partition-");
        executor.setConcurrencyLimit(partitions);
        return steps.step(MANAGER_STEP)
                .partitioner(workerStep.getName(), partitioner)
                .step(workerStep)
                .gridSize(partitions)
                .taskExecutor(executor)
                .build();
    }

    /**
     * No {@code RunIdIncrementer}: on Spring Batch 6 a job with an incrementer makes
     * {@code JobOperator.start(job, parameters)} IGNORE the parameters it is given (it starts
     * the next instance instead), which would silently drop the {@code source} parameter. Both
     * launch paths supply a unique {@code run.id} themselves.
     */
    @Bean
    public Job enterpriseJob(JobRepository jobRepository, Step managerStep) {
        return new JobBuilder(JOB_NAME, jobRepository)
                .start(managerStep)
                .build();
    }

    /**
     * {@code --run-batch [--source=file|database|list]} runs the job once at startup - what
     * the CronJob does. Without the flag the service only serves its endpoints.
     */
    @Bean
    public ApplicationRunner batchRunner(BatchOperator batchOperator, Job enterpriseJob) {
        return args -> {
            if (!args.containsOption("run-batch")) {
                return;
            }
            JobParametersBuilder parameters = new JobParametersBuilder()
                    .addLong("run.id", System.currentTimeMillis());
            List<String> sources = args.getOptionValues(SOURCE_PARAMETER);
            if (sources != null && !sources.isEmpty()) {
                parameters.addString(SOURCE_PARAMETER, sources.get(0));
            }
            batchOperator.start(enterpriseJob, parameters.toJobParameters());
        };
    }
}
