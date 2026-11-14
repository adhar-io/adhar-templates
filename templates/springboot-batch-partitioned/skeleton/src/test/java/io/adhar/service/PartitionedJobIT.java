package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.adhar.kit.batch.AdharBatchApplication;
import com.adhar.kit.batch.runtime.ExitCodes;
import com.adhar.kit.batch.runtime.KubernetesOwnerLookup;
import com.adhar.kit.test.container.PostgresTestContainer;
import io.adhar.service.job.ImportJobConfiguration;
import io.adhar.service.job.OutputRecord;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.batch.core.listener.ItemWriteListener;
import org.springframework.batch.core.step.item.ChunkOrientedStep;
import org.springframework.batch.infrastructure.item.Chunk;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * A partitioned run as the platform runs it (design 0025 §9.2, acceptance A2.2): one manager and two
 * workers, each its own Spring Boot application started through the kit's runner
 * ({@link AdharBatchApplication}) with the run contract the BatchJob composition sets on a gang's pods,
 * on ONE PostgreSQL — the JobRepository and the partition channel are all they share.
 *
 * <p>A worker is killed mid-partition: it stops inside a chunk, after committing the chunks before it,
 * and never commits again, which is all a SIGKILLed or OOM-killed pod is to the rest of the run. The
 * other worker finishes every other partition; the manager gives up waiting for the dead one at its
 * timeout ({@code ADHAR_BATCH_PARTITION_TIMEOUT}), fences it and exits 5, retryable. The gang is then
 * restarted — Volcano's {@code RestartJob}: the surviving pods are stopped, a new manager and two new
 * workers start — and the restart must re-run ONLY the partition that did not finish, from its last
 * commit, so that every input row is written exactly once. Last, the dead worker "wakes up" and tries to
 * commit the chunk it held: the fence must make that commit fail.</p>
 *
 * <p>Outside a cluster the manager cannot see that a pod is gone, so it waits for its timeout; on the
 * platform the kit's worker watch fails the partition within seconds, and the rest is the same.</p>
 */
class PartitionedJobIT {

    private static final int ROWS = 400;
    private static final int GRID = 4;
    private static final int CHUNK = 10;
    /** The NTILE ranges are 1-100, 101-200, ...: 155 is the sixth chunk of the second range. */
    private static final long KILLED_AT = 155;
    private static final String PARAMS = "{\"" + ImportJobConfiguration.BUSINESS_DATE + "\":\"2026-11-03\"}";
    /** What a pod stopped by its SIGTERM reports: the JVM's signal status (128 + 15). */
    private static final int TERMINATED = 143;

    private static final AtomicInteger DATABASES = new AtomicInteger();

    private final List<Pod> pods = new ArrayList<>();
    private final Gate gate = new Gate();
    private String url;
    private PostgreSQLContainer<?> postgres;
    private JdbcTemplate jdbc;

    @BeforeEach
    void database() throws Exception {
        postgres = PostgresTestContainer.platformInstance();
        String database = "partitioned_" + DATABASES.incrementAndGet();
        try (Connection connection = DriverManager.getConnection(postgres.getJdbcUrl(), postgres.getUsername(),
                postgres.getPassword()); Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + database);
        }
        url = "jdbc:postgresql://" + postgres.getHost() + ":" + postgres.getMappedPort(PostgreSQLContainer.POSTGRESQL_PORT)
                + "/" + database;
        jdbc = new JdbcTemplate(new DriverManagerDataSource(url, postgres.getUsername(), postgres.getPassword()));
        // The input exists before the job's first run, as on the platform when a team loads it first:
        // Flyway baselines the non-empty schema and still creates batch_output.
        jdbc.execute("CREATE TABLE IF NOT EXISTS public.batch_input (id bigint PRIMARY KEY, payload text NOT NULL)");
        jdbc.update("INSERT INTO public.batch_input SELECT g, 'row-' || g FROM generate_series(1, ?) g", ROWS);
    }

    @AfterEach
    void stopPods() {
        gate.release();
        pods.forEach(Pod::terminate);
    }

    @Test
    void aWorkerKilledMidPartitionCostsOneRestartOfThatPartitionAndNoRowTwice() throws Exception {
        gate.holdAt(KILLED_AT);
        Pod first = start("importer-worker-0", "worker");
        Pod second = start("importer-worker-1", "worker");
        Pod manager = start("importer-manager", "manager", "--adhar.batch.partition.timeout=20s");

        // Attempt 1: a worker dies inside a partition, the other finishes the rest, the manager times out.
        assertThat(gate.awaitHeld(Duration.ofMinutes(2))).as("a worker reached row %d", KILLED_AT).isTrue();
        Pod killed = gate.heldBy().equals(first.name) ? first : second;
        Pod survivor = killed == first ? second : first;
        // One image, two halves: the manager never builds the worker step, a worker does.
        assertThat(manager.context.get().containsBean(ImportJobConfiguration.WORKER_STEP)).isFalse();
        assertThat(survivor.context.get().containsBean(ImportJobConfiguration.WORKER_STEP)).isTrue();
        assertThat(manager.exitCode(Duration.ofMinutes(2))).as("the manager's exit: retryable, not STOPPED")
                .isEqualTo(ExitCodes.FAILED_RETRYABLE);
        long attempt1 = lastExecution();
        Map<String, String> attempt1Partitions = partitionStatuses(attempt1);
        assertThat(attempt1Partitions).hasSize(GRID);
        String unfinished = attempt1Partitions.entrySet().stream().filter(e -> !e.getValue().equals("COMPLETED"))
                .map(Map.Entry::getKey).reduce((a, b) -> a + "," + b).orElse("");
        assertThat(attempt1Partitions.get(unfinished)).as("the dead worker's partition, fenced at the manager's timeout")
                .isEqualTo("FAILED");
        long committedBeforeTheKill = writes(attempt1, unfinished);
        assertThat(committedBeforeTheKill).as("the kill landed mid-partition, after its first commits")
                .isEqualTo(50L);

        // The gang restart: the survivor is stopped, a new manager and two new workers start.
        survivor.terminate();
        Pod replacement0 = start("importer-worker-0", "worker");
        Pod replacement1 = start("importer-worker-1", "worker");
        Pod restarted = start("importer-manager", "manager");

        assertThat(restarted.exitCode(Duration.ofMinutes(2))).isEqualTo(ExitCodes.COMPLETED);
        assertThat(replacement0.exitCode(Duration.ofSeconds(60))).isEqualTo(ExitCodes.COMPLETED);
        assertThat(replacement1.exitCode(Duration.ofSeconds(60))).isEqualTo(ExitCodes.COMPLETED);
        long attempt2 = lastExecution();
        assertThat(attempt2).isNotEqualTo(attempt1);
        assertThat(partitionStatuses(attempt2)).as("only the partition that did not finish ran again")
                .containsOnlyKeys(unfinished).containsValue("COMPLETED");
        assertThat(reads(attempt2, unfinished)).as("resumed after its last commit, not from its start")
                .isEqualTo(ROWS / GRID - committedBeforeTheKill);
        assertExactlyOnce();

        // The dead worker was only frozen: let it try to commit the chunk it held. The fence must fail
        // that commit — its upserts included. They would write the same values the restart wrote, so the
        // restart's rows of that chunk are marked first: a zombie commit would overwrite the mark.
        int marked = jdbc.update("UPDATE public.batch_output SET payload = 'written-by-the-restart' WHERE id BETWEEN ? AND ?",
                KILLED_AT - 4, KILLED_AT + 5);
        assertThat(marked).isEqualTo(CHUNK);
        gate.release();
        killed.exitCode(Duration.ofSeconds(60));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.batch_output WHERE payload = 'written-by-the-restart'",
                Integer.class)).as("the frozen worker's chunk never reached the table").isEqualTo(CHUNK);
        assertThat(writes(attempt1, unfinished)).as("nor its progress").isEqualTo(committedBeforeTheKill);
        assertThat(partitionStatuses(attempt1).get(unfinished)).isEqualTo("FAILED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.batch_output", Integer.class)).isEqualTo(ROWS);
        assertThat(committedWrites()).isEqualTo((long) ROWS);
    }

    /** Every input row is in the output once, transformed, and the executions' committed writes add up to the input. */
    private void assertExactlyOnce() {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.batch_output", Integer.class)).isEqualTo(ROWS);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.batch_input i JOIN public.batch_output o "
                + "ON o.id = i.id AND o.payload = UPPER(REPLACE(i.payload, '-', '_'))", Integer.class)).isEqualTo(ROWS);
        assertThat(committedWrites()).as("committed writes over every execution: each row once").isEqualTo((long) ROWS);
    }

    private long committedWrites() {
        return jdbc.queryForObject("SELECT SUM(write_count) FROM batch.batch_step_execution WHERE step_name LIKE ?",
                Long.class, ImportJobConfiguration.WORKER_STEP + ":%");
    }

    private long lastExecution() {
        return jdbc.queryForObject("SELECT MAX(e.job_execution_id) FROM batch.batch_job_execution e JOIN "
                + "batch.batch_job_instance i ON i.job_instance_id = e.job_instance_id WHERE i.job_name = ?",
                Long.class, ImportJobConfiguration.JOB);
    }

    private Map<String, String> partitionStatuses(long execution) {
        Map<String, String> partitions = new LinkedHashMap<>();
        jdbc.query("SELECT step_name, status FROM batch.batch_step_execution WHERE job_execution_id = ? AND step_name LIKE ? "
                + "ORDER BY step_name", rs -> {
                    partitions.put(rs.getString(1), rs.getString(2));
                }, execution, ImportJobConfiguration.WORKER_STEP + ":%");
        return partitions;
    }

    private long writes(long execution, String partition) {
        return count("write_count", execution, partition);
    }

    private long reads(long execution, String partition) {
        return count("read_count", execution, partition);
    }

    private long count(String column, long execution, String partition) {
        return jdbc.queryForObject("SELECT " + column + " FROM batch.batch_step_execution WHERE job_execution_id = ? "
                + "AND step_name = ?", Long.class, execution, partition);
    }

    /**
     * A pod of the run: the application in its own context and thread, started the way the image's
     * {@code main} starts it, with what the composition puts in a gang pod's environment. Spring reads
     * the platform's variables by these exact names, and the {@code adhar.batch.*} settings by the
     * names {@code ADHAR_BATCH_ROLE} and {@code ADHAR_BATCH_PARTITION_*} bind to.
     */
    private Pod start(String name, String role, String... extra) {
        Pod pod = new Pod(name);
        SpringApplication application = new SpringApplication(Application.class);
        application.setBannerMode(Banner.Mode.OFF);
        application.addInitializers(context -> {
            pod.context.set(context);
            // Outside a cluster: no Kubernetes API to read (app-ci's test pod has one, and it is not ours).
            context.getBeanFactory().registerSingleton("kubernetesOwnerLookup", KubernetesOwnerLookup.unavailable());
            context.getBeanFactory().addBeanPostProcessor(gate);
        });
        List<String> args = new ArrayList<>(List.of(
                "--ADHAR_BATCH_JOB=" + ImportJobConfiguration.JOB,
                "--ADHAR_BATCH_NAME=importer",
                "--ADHAR_BATCH_TRIGGER=manual",
                "--ADHAR_BATCH_PARAMS=" + PARAMS,
                "--ADHAR_BATCH_TIME_ZONE=UTC",
                "--POD_NAME=" + name,
                "--adhar.batch.role=" + role,
                "--adhar.batch.partition.transport=jdbc",
                "--adhar.batch.partition.grid-size=" + GRID,
                "--adhar.batch.partition.poll-interval=200ms",
                "--adhar.batch.chunk.size=" + CHUNK,
                "--adhar.batch.shutdown.timeout=10s",
                "--spring.datasource.url=" + url,
                "--spring.datasource.username=" + postgres.getUsername(),
                "--spring.datasource.password=" + postgres.getPassword(),
                // No collector on the test host: nothing to push to.
                "--management.otlp.metrics.export.enabled=false",
                "--adhar.tracing.open-telemetry.enabled=false",
                // Three contexts share this JVM's console: the run's own story is enough.
                "--logging.level.root=WARN",
                "--logging.level.com.adhar.kit.batch=INFO"));
        args.addAll(List.of(extra));
        Thread thread = new Thread(() -> {
            try {
                AdharBatchApplication.run(application, pod.exit::complete, args.toArray(String[]::new));
            } catch (Throwable failure) {
                pod.exit.completeExceptionally(failure);
            } finally {
                // The runner does not call exit when the context was closed under it (a SIGTERM).
                pod.exit.complete(TERMINATED);
            }
        }, name);
        thread.setDaemon(true);
        pod.thread = thread;
        pods.add(pod);
        thread.start();
        return pod;
    }

    private static final class Pod {

        private final String name;
        private final CompletableFuture<Integer> exit = new CompletableFuture<>();
        private final AtomicReference<ConfigurableApplicationContext> context = new AtomicReference<>();
        private Thread thread;

        private Pod(String name) {
            this.name = name;
        }

        int exitCode(Duration timeout) throws Exception {
            return exit.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }

        /** SIGTERM: the context closes, and the kit stops whatever the pod was doing at a chunk boundary. */
        void terminate() {
            ConfigurableApplicationContext running = context.get();
            if (running != null && running.isActive()) {
                running.close();
            }
            try {
                thread.join(Duration.ofSeconds(30));
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * Freezes the first worker that is about to write the chunk holding a chosen row: inside the chunk's
     * transaction, after the partition's earlier chunks committed. Registered in every pod, it holds once.
     */
    private static final class Gate implements BeanPostProcessor {

        private volatile long at = -1;
        private volatile String heldBy = "";
        private final CountDownLatch reached = new CountDownLatch(1);
        private final CountDownLatch released = new CountDownLatch(1);

        void holdAt(long row) {
            at = row;
        }

        @Override
        @SuppressWarnings("unchecked")
        public Object postProcessAfterInitialization(Object bean, String beanName) {
            if (ImportJobConfiguration.WORKER_STEP.equals(beanName) && bean instanceof ChunkOrientedStep<?, ?> step) {
                ((ChunkOrientedStep<?, OutputRecord>) step).registerItemWriteListener(new ItemWriteListener<>() {
                    @Override
                    public void beforeWrite(Chunk<? extends OutputRecord> items) {
                        hold(items);
                    }
                });
            }
            return bean;
        }

        private synchronized void claim(String thread) {
            at = -1;
            heldBy = thread;
            reached.countDown();
        }

        private void hold(Chunk<? extends OutputRecord> items) {
            long row = at;
            if (row < 0 || items.getItems().stream().noneMatch(item -> item.id() == row)) {
                return;
            }
            claim(Thread.currentThread().getName());
            try {
                if (!released.await(5, TimeUnit.MINUTES)) {
                    throw new IllegalStateException("the frozen worker was never released");
                }
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(ex);
            }
        }

        boolean awaitHeld(Duration timeout) throws InterruptedException {
            return reached.await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }

        /** The pod's thread is named after the pod. */
        String heldBy() {
            return heldBy;
        }

        void release() {
            released.countDown();
        }
    }
}
