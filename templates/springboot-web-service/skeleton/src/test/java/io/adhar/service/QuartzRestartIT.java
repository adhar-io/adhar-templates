{%- if values.inServiceBatch %}
package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.quartz.Scheduler;
import org.springframework.batch.core.listener.ItemWriteListener;
import org.springframework.batch.core.step.item.ChunkOrientedStep;
import org.springframework.batch.infrastructure.item.Chunk;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.Banner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.postgresql.PostgreSQLContainer;

import com.adhar.kit.batch.scheduler.BatchScheduler;
import com.adhar.kit.batch.scheduler.quartz.BatchTriggers;

import io.adhar.service.batch.Settlement;
import io.adhar.service.batch.SettlementJobConfiguration;

/**
 * The in-service batch job survives a replica dying mid-run (design 0025 §5.20.5, acceptance AQ.3):
 * two replicas of this service — two application contexts, started as {@code main} starts the image —
 * share ONE PostgreSQL, as the Rollout's pods share the service's database, and with it one clustered
 * Quartz schedule and one Spring Batch JobRepository.
 *
 * <p>The first replica starts the sample job through {@link BatchTriggers} and is frozen inside its
 * third chunk, after two chunks committed. While it still checks in, the second replica asking for the
 * same run is told it is PENDING: one identity, one run. Then the first replica "dies" — its Quartz
 * scheduler stops checking in and acquiring, which is all a SIGKILLed pod is to the rest of the
 * cluster — and the second re-fires the run as a recovery and completes it from the last commit: every
 * payment settled once, the same JobInstance, the same run name. Last, the frozen replica wakes and
 * tries to commit the chunk it held, and the kit's fence makes that commit fail.</p>
 *
 * <p>It ends by reading the second replica's {@code /actuator/prometheus}: every series and label the
 * in-service batch alerts in {@code deploy/base/alerts.yaml} select must be there, so an alert can
 * never watch a series this service does not publish.</p>
 *
 * <p>Like {@link ApiIT}, it needs a Docker API (kubedock in CI), and it runs in UTC: the build pins the
 * test JVM's zone (pom.xml) because the {@code intraday} trigger is a Quartz daily trigger, which runs
 * in the JVM's zone. Its deadlines are generous on purpose: app-ci's test pod is several times slower
 * than a laptop, and nothing here measures speed.</p>
 */
@Timeout(value = 15, unit = TimeUnit.MINUTES)
class QuartzRestartIT {

    private static final int ROWS = 60;
    private static final int CHUNK = 10;
    /** In the third chunk (21-30): the first two committed before the replica froze. */
    private static final long FROZEN_AT = 25;
    private static final LocalDate DAY = LocalDate.of(2026, 11, 3);
    private static final Duration PATIENCE = Duration.ofMinutes(5);
    private static final Pattern SELECTOR = Pattern.compile("([a-zA-Z_:][a-zA-Z0-9_:]*)\\{([^}]*)\\}");
    private static final Pattern LABEL = Pattern.compile("([a-zA-Z_][a-zA-Z0-9_]*)\\s*(=~|!~|!=|=)");
    private static final Pattern BY = Pattern.compile("by \\(([^)]*)\\)");

    /** The major version compose.yaml and the other integration tests run. */
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17-alpine");

    private final List<ConfigurableApplicationContext> replicas = new ArrayList<>();
    private final Gate gate = new Gate();
    private JdbcTemplate jdbc;

    @BeforeAll
    static void startDatabase() {
        POSTGRES.start();
    }

    @AfterAll
    static void stopDatabase() {
        POSTGRES.stop();
    }

    @AfterEach
    void stopReplicas() {
        gate.release();
        replicas.forEach(ConfigurableApplicationContext::close);
    }

    @Test
    void aReplicaKilledMidRunIsRecoveredByAnotherAndEveryPaymentIsSettledOnce() throws Exception {
        ConfigurableApplicationContext first = replica(gate);
        jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword()));
        jdbc.update("INSERT INTO public.payments (id, business_date, account, amount) "
                + "SELECT g, ?, 'acc-' || g, g * 1.5 FROM generate_series(1, ?) g", DAY, ROWS);

        // The service's own code asks for the day's settlement; the first replica takes it and freezes mid-run.
        gate.holdAt(FROZEN_AT);
        BatchTriggers.Result asked = first.getBean(BatchTriggers.class).fireNow(SettlementJobConfiguration.JOB,
                Map.of(SettlementJobConfiguration.BUSINESS_DATE, DAY.toString()));
        assertThat(asked.status()).isEqualTo(BatchTriggers.Status.SCHEDULED);
        assertThat(gate.awaitHeld(PATIENCE)).as("the first replica reached payment %d", FROZEN_AT).isTrue();
        assertThat(settled()).as("two chunks committed before it froze").isEqualTo(2 * CHUNK);

        // While its owner checks in, the same identity asked for on the other replica is that run, pending.
        ConfigurableApplicationContext second = replica(null);
        BatchTriggers.Result again = second.getBean(BatchTriggers.class).fireNow(SettlementJobConfiguration.JOB,
                Map.of(SettlementJobConfiguration.BUSINESS_DATE, DAY.toString(), SettlementJobConfiguration.CYCLE, "close"));
        assertThat(again.status()).isEqualTo(BatchTriggers.Status.PENDING);
        assertThat(again.runName()).isEqualTo(asked.runName());
        assertThat(executions()).extracting(Execution::status).containsExactly("STARTED");

        // The first replica dies. Quartz notices its missing check-ins and re-fires its run on the second.
        first.getBean(Scheduler.class).shutdown(false);
        await("the second replica completes the recovered run", () -> {
            List<Execution> all = executions();
            return all.size() == 2 && all.get(1).status().equals("COMPLETED");
        });
        List<Execution> runs = executions();
        assertThat(runs.get(0).status()).as("the dead replica's execution, recovered").isEqualTo("FAILED");
        assertThat(runs.get(1).instance()).as("the same JobInstance: the same identity").isEqualTo(runs.get(0).instance());
        assertThat(runs.get(1).parameters()).as("the same run, by name (naming v1)")
                .containsEntry(BatchScheduler.RUN_PARAMETER, asked.runName());
        assertThat(stepCount("read_count", runs.get(1).id())).as("resumed after the last commit, not from the start")
                .isEqualTo(ROWS - 2 * CHUNK);
        assertSettledOnce();

        // The frozen replica was only frozen: let it try to commit the chunk it held. Its rows would carry the
        // same values the recovery wrote, so those are marked first; a commit that got through would overwrite them.
        int marked = jdbc.update("UPDATE public.settlements SET account = 'SETTLED-BY-THE-RECOVERY' "
                + "WHERE payment_id BETWEEN ? AND ?", 2 * CHUNK + 1, 3 * CHUNK);
        assertThat(marked).isEqualTo(CHUNK);
        gate.release();
        await("the frozen replica's run ends", () -> first.getBean(BatchScheduler.class).runningJobs().isEmpty());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.settlements WHERE account = 'SETTLED-BY-THE-RECOVERY'",
                Integer.class)).as("the frozen replica's chunk never committed").isEqualTo(CHUNK);
        assertThat(executions()).extracting(Execution::status).containsExactly("FAILED", "COMPLETED");
        assertThat(settled()).isEqualTo(ROWS);

        assertTheAlertsSelectWhatTheServicePublishes(second);
    }

    /** Every payment of the day is settled exactly once, and the two executions' commits add up to the day. */
    private void assertSettledOnce() {
        assertThat(settled()).isEqualTo(ROWS);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM public.payments p JOIN public.settlements s "
                + "ON s.payment_id = p.id AND s.account = UPPER(p.account) AND s.amount = p.amount AND s.business_date = p.business_date",
                Integer.class)).isEqualTo(ROWS);
        long written = executions().stream().mapToLong(run -> stepCount("write_count", run.id())).sum();
        assertThat(written).as("committed writes over both executions: each payment once").isEqualTo(ROWS);
    }

    /**
     * The series and labels the in-service batch alerts select, against what this service exposes. The
     * reader's renames are allowed for: a label the scrape target also sets ({@code job}) reaches
     * Prometheus as {@code exported_job}, and {@code pod}/{@code namespace} are the target's own.
     */
    private static void assertTheAlertsSelectWhatTheServicePublishes(ConfigurableApplicationContext replica)
            throws IOException, InterruptedException {
        String port = replica.getEnvironment().getProperty("local.server.port");
        HttpResponse<String> scrape = HttpClient.newHttpClient().send(HttpRequest.newBuilder(
                URI.create("http://localhost:" + port + "/actuator/prometheus")).build(), HttpResponse.BodyHandlers.ofString());
        assertThat(scrape.statusCode()).isEqualTo(200);
        Map<String, Set<String>> exposed = new LinkedHashMap<>();
        for (String line : scrape.body().split("\n")) {
            Matcher series = SELECTOR.matcher(line);
            if (!line.startsWith("#") && series.lookingAt()) {
                Set<String> labels = exposed.computeIfAbsent(series.group(1), name -> new LinkedHashSet<>());
                Matcher label = LABEL.matcher(series.group(2));
                while (label.find()) {
                    labels.add(label.group(1));
                }
            }
        }
        String alerts = Files.readString(Path.of("deploy/base/alerts.yaml"));
        int batch = alerts.indexOf("BatchInService");
        assertThat(batch).as("deploy/base/alerts.yaml carries the in-service batch alerts").isPositive();
        for (String expr : alerts.substring(batch).split("- alert: ")) {
            Set<String> metrics = new LinkedHashSet<>();
            Matcher selector = SELECTOR.matcher(expr);
            while (selector.find()) {
                String metric = selector.group(1);
                metrics.add(metric);
                assertThat(exposed).as("the alerts select %s", metric).containsKey(metric);
                Matcher matchers = LABEL.matcher(selector.group(2));
                while (matchers.find()) {
                    String label = matchers.group(1);
                    if (!targetLabel(label)) {
                        assertThat(exposed.get(metric)).as("%s carries the label %s", metric, label).contains(label);
                    }
                }
            }
            Matcher by = BY.matcher(expr);
            while (by.find()) {
                for (String raw : by.group(1).split(",")) {
                    String label = raw.trim().replaceFirst("^exported_", "");
                    if (!targetLabel(label)) {
                        assertThat(metrics.stream().anyMatch(metric -> exposed.get(metric).contains(label)))
                                .as("a series the rule selects carries %s", label).isTrue();
                    }
                }
            }
        }
    }

    private static boolean targetLabel(String label) {
        return label.equals("pod") || label.equals("namespace");
    }

    private int settled() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM public.settlements", Integer.class);
    }

    private long stepCount(String column, long execution) {
        return jdbc.queryForObject("SELECT " + column + " FROM batch.batch_step_execution WHERE job_execution_id = ? "
                + "AND step_name = ?", Long.class, execution, SettlementJobConfiguration.STEP);
    }

    /** An execution of the job, as the JobRepository holds it. */
    private record Execution(long id, long instance, String status, Map<String, String> parameters) {
    }

    private List<Execution> executions() {
        return jdbc.query("SELECT e.job_execution_id, e.job_instance_id, e.status FROM batch.batch_job_execution e "
                + "JOIN batch.batch_job_instance i ON i.job_instance_id = e.job_instance_id WHERE i.job_name = ? "
                + "ORDER BY e.job_execution_id", (rs, row) -> {
                    Map<String, String> parameters = new LinkedHashMap<>();
                    jdbc.query("SELECT parameter_name, parameter_value FROM batch.batch_job_execution_params "
                            + "WHERE job_execution_id = ?", params -> {
                                parameters.put(params.getString(1), params.getString(2));
                            }, rs.getLong(1));
                    return new Execution(rs.getLong(1), rs.getLong(2), rs.getString(3), parameters);
                }, SettlementJobConfiguration.JOB);
    }

    private static void await(String what, BooleanSupplier condition) throws InterruptedException {
        long deadline = System.nanoTime() + PATIENCE.toNanos();
        while (!condition.getAsBoolean()) {
            assertThat(System.nanoTime()).as("waiting for: %s", what).isLessThan(deadline);
            Thread.sleep(200);
        }
    }

    /**
     * A replica: the application as the image's {@code main} starts it, in its own context, on the shared
     * database. Started one at a time (they share this JVM's logging, which each start re-initialises).
     */
    private ConfigurableApplicationContext replica(BeanPostProcessor withGate) {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        SpringApplication application = new SpringApplication(Application.class);
        application.setBannerMode(Banner.Mode.OFF);
        if (withGate != null) {
            application.addInitializers(context -> context.getBeanFactory().addBeanPostProcessor(withGate));
        }
        List<String> args = new ArrayList<>(List.of(
                "--spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                "--spring.datasource.username=" + POSTGRES.getUsername(),
                "--spring.datasource.password=" + POSTGRES.getPassword(),
                "--server.port=0",
                // As in ApiIT: no Kubernetes discovery, in CI's test pod or on a laptop.
                "--spring.main.cloud-platform=none",
                // Not the CI pod's namespace to write a schedule report into.
                "--adhar.batch.quartz.report.enabled=false",
                // A dead replica noticed within seconds, and a trigger another replica stores acquired at once
                // (Quartz's scheduler thread otherwise sleeps up to 30 s when nothing is due). Quartz takes a
                // replica for dead when it misses its check-ins for this interval plus 7.5 s; much less, and a
                // live replica on a loaded CI node can look dead and have its run recovered under it.
                "--adhar.batch.quartz.cluster-checkin-interval=5s",
                "--spring.quartz.properties.org.quartz.scheduler.idleWaitTime=1000",
                "--adhar.batch.chunk.size=" + CHUNK,
                "--adhar.batch.shutdown.timeout=10s",
                // The configured triggers stay out of the way: today and tomorrow are holidays of their calendar,
                // so only the run this test asks for runs.
                "--adhar.batch.quartz.calendars.weekdays.holidays=" + today + "," + today.plusDays(1),
                "--logging.level.root=WARN",
                "--logging.level.com.adhar.kit.batch=INFO"));
{%- if values.withKafka %}
        // No broker here: the sample event listener would only retry against one.
        args.add("--spring.kafka.listener.auto-startup=false");
{%- endif %}
        ConfigurableApplicationContext context = application.run(args.toArray(String[]::new));
        replicas.add(context);
        return context;
    }

    /**
     * Freezes the run that is about to write the chunk holding a chosen payment: inside the chunk's
     * transaction, after the earlier chunks committed. Registered in the first replica only.
     */
    private static final class Gate implements BeanPostProcessor {

        private volatile long at = -1;
        private final CountDownLatch reached = new CountDownLatch(1);
        private final CountDownLatch released = new CountDownLatch(1);

        void holdAt(long payment) {
            at = payment;
        }

        @Override
        @SuppressWarnings("unchecked")
        public Object postProcessAfterInitialization(Object bean, String beanName) {
            if (SettlementJobConfiguration.STEP.equals(beanName) && bean instanceof ChunkOrientedStep<?, ?> step) {
                ((ChunkOrientedStep<?, Settlement>) step).registerItemWriteListener(new ItemWriteListener<>() {
                    @Override
                    public void beforeWrite(Chunk<? extends Settlement> items) {
                        hold(items);
                    }
                });
            }
            return bean;
        }

        private void hold(Chunk<? extends Settlement> items) {
            long payment = at;
            if (payment < 0 || items.getItems().stream().noneMatch(item -> item.paymentId() == payment)) {
                return;
            }
            at = -1;
            reached.countDown();
            try {
                if (!released.await(PATIENCE.toMillis(), TimeUnit.MILLISECONDS)) {
                    throw new IllegalStateException("the frozen replica was never released");
                }
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(ex);
            }
        }

        boolean awaitHeld(Duration timeout) throws InterruptedException {
            return reached.await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }

        void release() {
            released.countDown();
        }
    }
}
{%- endif %}
