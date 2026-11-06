package io.adhar.service;

import io.adhar.service.batch.BatchMetricsListener;
import io.adhar.service.batch.EnterpriseBatchProperties;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import javax.sql.DataSource;
import org.springframework.batch.core.Job;
import org.springframework.batch.core.JobParametersBuilder;
import org.springframework.batch.core.Step;
import org.springframework.batch.core.configuration.annotation.EnableBatchProcessing;
import org.springframework.batch.core.configuration.annotation.JobBuilderFactory;
import org.springframework.batch.core.configuration.annotation.StepBuilderFactory;
import org.springframework.batch.core.launch.JobLauncher;
import org.springframework.batch.core.launch.support.RunIdIncrementer;
import org.springframework.batch.core.partition.PartitionHandler;
import org.springframework.batch.core.partition.support.Partitioner;
import org.springframework.batch.core.partition.support.TaskExecutorPartitionHandler;
import org.springframework.batch.core.step.tasklet.TaskletStep;
import org.springframework.batch.item.ItemProcessor;
import org.springframework.batch.item.ItemReader;
import org.springframework.batch.item.ItemWriter;
import org.springframework.batch.item.database.JdbcPagingItemReader;
import org.springframework.batch.item.database.Order;
import org.springframework.batch.item.database.support.PostgresPagingQueryProvider;
import org.springframework.batch.item.file.FlatFileItemReader;
import org.springframework.batch.item.file.builder.FlatFileItemReaderBuilder;
import org.springframework.batch.item.file.mapping.DefaultLineMapper;
import org.springframework.batch.item.file.transform.PassThroughLineMapper;
import org.springframework.batch.item.support.ListItemReader;
import org.springframework.batch.retry.backoff.FixedBackOff;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.task.SimpleAsyncTaskExecutor;
import org.springframework.batch.core.partition.support.SimplePartitioner;
import org.springframework.batch.item.ExecutionContext;

@Configuration
@EnableBatchProcessing
public class BatchConfiguration {

    @Bean
    public ItemReader<String> batchReader(DataSource dataSource, EnterpriseBatchProperties properties) {
        if ("database".equalsIgnoreCase(properties.getInputType())) {
            JdbcPagingItemReader<String> reader = new JdbcPagingItemReader<>();
            reader.setDataSource(dataSource);
            reader.setPageSize(properties.getChunkSize());
            reader.setFetchSize(properties.getChunkSize());
            reader.setName("databaseBatchReader");
            PostgresPagingQueryProvider queryProvider = new PostgresPagingQueryProvider();
            queryProvider.setSelectClause("SELECT payload");
            queryProvider.setFromClause("FROM batch_input");
            Map<String, Order> sortKeys = new HashMap<>();
            sortKeys.put("id", Order.ASCENDING);
            queryProvider.setSortKeys(sortKeys);
            reader.setQueryProvider(queryProvider);
            reader.setRowMapper((rs, rowNum) -> rs.getString("payload"));
            return reader;
        }

        FlatFileItemReader<String> reader = new FlatFileItemReaderBuilder<String>()
                .name("fileBatchReader")
                .resource(new ClassPathResource(properties.getFilePath()))
                .lineMapper(new PassThroughLineMapper())
                .build();
        return reader;
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
        return items -> items.forEach(item -> System.out.println("Processed batch item: " + item));
    }

    @Bean
    public Partitioner partitioner(EnterpriseBatchProperties properties) {
        return new SimplePartitioner() {
            @Override
            public Map<String, ExecutionContext> partition(int gridSize) {
                Map<String, ExecutionContext> partitions = new HashMap<>();
                int target = Math.max(1, Math.min(gridSize, properties.getPartitionCount()));
                for (int i = 0; i < target; i++) {
                    ExecutionContext context = new ExecutionContext();
                    context.putInt("partitionIndex", i);
                    partitions.put("partition" + i, context);
                }
                return partitions;
            }
        };
    }

    @Bean
    public PartitionHandler partitionHandler(EnterpriseBatchProperties properties, Step workerStep) {
        TaskExecutorPartitionHandler handler = new TaskExecutorPartitionHandler();
        handler.setTaskExecutor(new SimpleAsyncTaskExecutor("batch-partition-"));
        handler.setStep(workerStep);
        handler.setGridSize(properties.getPartitionCount());
        return handler;
    }

    @Bean
    public Step workerStep(
            StepBuilderFactory stepBuilderFactory,
            ItemReader<String> batchReader,
            ItemProcessor<String, String> itemProcessor,
            ItemWriter<String> itemWriter,
            EnterpriseBatchProperties properties) {
        return stepBuilderFactory.get("workerStep")
                .<String, String>chunk(properties.getChunkSize())
                .reader(batchReader)
                .processor(itemProcessor)
                .writer(itemWriter)
                .faultTolerant()
                .retryLimit(properties.getRetryLimit())
                .retry(IllegalStateException.class)
                .backOffPolicy(new FixedBackOff(properties.getBackoffMs(), 1L))
                .build();
    }

    @Bean
    public Step managerStep(
            StepBuilderFactory stepBuilderFactory,
            Step workerStep,
            Partitioner partitioner,
            PartitionHandler partitionHandler) {
        return stepBuilderFactory.get("managerStep")
                .partitioner(workerStep.getName(), partitioner)
                .step(workerStep)
                .partitionHandler(partitionHandler)
                .build();
    }

    @Bean
    public Job enterpriseJob(JobBuilderFactory jobBuilderFactory, Step managerStep, BatchMetricsListener metricsListener) {
        return jobBuilderFactory.get("enterprise-job")
                .incrementer(new RunIdIncrementer())
                .listener(metricsListener)
                .start(managerStep)
                .build();
    }

    @Bean
    public ApplicationRunner batchRunner(JobLauncher jobLauncher, Job enterpriseJob) {
        return args -> {
            if (args.getOptionValues("run-batch") == null) {
                return;
            }
            org.springframework.batch.core.JobParameters parameters =
                    new JobParametersBuilder()
                            .addLong("run.id", System.currentTimeMillis())
                            .toJobParameters();
            jobLauncher.run(enterpriseJob, parameters);
        };
    }
}
