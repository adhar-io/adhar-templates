package io.adhar.service;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

import org.junit.jupiter.api.Test;

import com.intuit.karate.JsonUtils;
import com.sun.net.httpserver.HttpServer;

/**
 * Starts the PACKAGED application the way its pod starts it: with the environment
 * {@code deploy/base/rollout.yaml} gives the {@code app} container and nothing
 * inherited from the build. The application must become ready on the Rollout's
 * readiness probe, stay up, and deliver its traces and metrics over OTLP.
 *
 * <p>{@link ApiIT} cannot see a broken environment: {@code @QuarkusIntegrationTest}
 * launches the jar with the test's configuration, not the Rollout's. That is how
 * {@code OTEL_TRACES_EXPORTER=otlp} (with its metrics and logs siblings) passed every
 * test and then crash-looped every pod: it makes the OpenTelemetry SDK inside Quarkus
 * build an OTLP exporter that needs an HTTP sender Quarkus does not ship ("No
 * HttpSenderProvider found on classpath").
 *
 * <p>Only values that cannot be the cluster's differ from a pod: {@code PORT} is a free
 * local port; {@code OTEL_EXPORTER_OTLP_ENDPOINT} is a collector inside this test that
 * records what arrives (protocol, exporters and resource attributes stay the
 * Rollout's); fields a pod reads from its own metadata, and values it reads from a
 * Secret, are stand-ins. A stand-in database URL names a local port nothing listens
 * on: the application does not connect at startup, and the database itself is
 * {@link ApiIT}'s to test. Run by {@code mvn verify}, after the jar is packaged.
 */
class RolloutEnvIT {

    static final Path ROLLOUT = Path.of("deploy", "base", "rollout.yaml");
    static final Path TARGET = Path.of("target");
    static final Duration STARTUP = Duration.ofMinutes(3);
    static final Duration EXPORT = Duration.ofSeconds(90);
    static final Pattern REFERENCE = Pattern.compile("\\$\\(([A-Za-z_][A-Za-z0-9_]*)\\)");

    /** What the stand-in collector received, by request path. */
    final Map<String, List<byte[]>> received = new ConcurrentHashMap<>();

    @Test
    void thePackagedAppStartsAndExportsWithTheRolloutsEnvironment() throws Exception {
        Map<String, Object> container = appContainer();
        Map<String, String> env = environmentOf(container);
        String service = env.getOrDefault("OTEL_SERVICE_NAME", "");
        assertFalse(service.isBlank(), ROLLOUT + " sets no OTEL_SERVICE_NAME");

        HttpServer collector = startCollector();
        int port = freePort();
        env.put("PORT", String.valueOf(port));
        env.put("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:" + collector.getAddress().getPort());

        Path log = TARGET.resolve("rollout-env-it.log");
        ProcessBuilder launch = new ProcessBuilder(launchCommand())
                .redirectErrorStream(true)
                .redirectOutput(log.toFile());
        Map<String, String> processEnv = launch.environment();
        processEnv.clear();
        for (String keep : List.of("PATH", "HOME", "TMPDIR")) {
            String value = System.getenv(keep);
            if (value != null) {
                processEnv.put(keep, value);
            }
        }
        processEnv.putAll(env);

        Process app = launch.start();
        try {
            URI probe = URI.create("http://127.0.0.1:" + port + readinessPath(container));
            awaitReady(app, probe, log);
            HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
            for (int i = 0; i < 5; i++) {
                http.send(HttpRequest.newBuilder(probe).timeout(Duration.ofSeconds(10)).build(),
                        HttpResponse.BodyHandlers.discarding());
            }
            await(() -> carries("/v1/traces", service), EXPORT,
                    () -> "no trace for service " + service + " reached the collector in " + EXPORT
                            + "; received " + received.keySet() + "\n" + tail(log));
            assertTrue(app.isAlive(), () -> "the application exited after it became ready\n" + tail(log));
        } finally {
            // SIGTERM, as the kubelet stops a container: a graceful shutdown.
            app.destroy();
            if (!app.waitFor(60, TimeUnit.SECONDS)) {
                app.destroyForcibly();
            }
            collector.stop(0);
        }
        // Micrometer pushes every step (one minute) and once more when it closes.
        assertTrue(carries("/v1/metrics", service),
                () -> "no metrics for service " + service + " reached the collector; received "
                        + received.keySet() + "\n" + tail(log));
    }

    /** The container named {@code app} (else the first) of the Rollout's pod template. */
    @SuppressWarnings("unchecked")
    static Map<String, Object> appContainer() throws IOException {
        Map<String, Object> rollout = (Map<String, Object>) JsonUtils.fromYaml(Files.readString(ROLLOUT));
        Map<String, Object> spec = (Map<String, Object>) rollout.get("spec");
        Map<String, Object> pod = (Map<String, Object>) ((Map<String, Object>) spec.get("template")).get("spec");
        List<Map<String, Object>> containers = (List<Map<String, Object>>) pod.get("containers");
        return containers.stream().filter(c -> "app".equals(c.get("name"))).findFirst().orElse(containers.get(0));
    }

    /**
     * The container's environment, resolved as the kubelet resolves it: a literal
     * {@code value} with {@code $(NAME)} references to variables defined before it
     * expanded, {@code valueFrom} a stand-in.
     */
    @SuppressWarnings("unchecked")
    static Map<String, String> environmentOf(Map<String, Object> container) {
        Map<String, String> env = new LinkedHashMap<>();
        for (Map<String, Object> e : (List<Map<String, Object>>) container.getOrDefault("env", List.of())) {
            String name = String.valueOf(e.get("name"));
            if (e.containsKey("value")) {
                Matcher m = REFERENCE.matcher(String.valueOf(e.get("value")));
                StringBuilder value = new StringBuilder();
                while (m.find()) {
                    m.appendReplacement(value, Matcher.quoteReplacement(env.getOrDefault(m.group(1), m.group())));
                }
                env.put(name, m.appendTail(value).toString());
            } else {
                env.put(name, standIn((Map<String, Object>) e.get("valueFrom")));
            }
        }
        return env;
    }

    @SuppressWarnings("unchecked")
    static String standIn(Map<String, Object> from) {
        if (from.get("fieldRef") instanceof Map<?, ?> field) {
            return switch (String.valueOf(field.get("fieldPath"))) {
                case "metadata.namespace" -> "rollout-env-it";
                case "metadata.name" -> "rollout-env-it-0";
                case "status.podIP", "status.hostIP" -> "127.0.0.1";
                default -> "stand-in";
            };
        }
        if (from.get("secretKeyRef") instanceof Map<?, ?> secret) {
            // The keys of a CloudNativePG application Secret (<name>-db-app).
            return switch (String.valueOf(secret.get("key"))) {
                case "jdbc-uri" -> "jdbc:postgresql://127.0.0.1:1/app";
                case "uri" -> "postgresql://app:stand-in@127.0.0.1:1/app";
                case "host" -> "127.0.0.1";
                case "port" -> "1";
                case "username", "user", "dbname" -> "app";
                default -> "stand-in";
            };
        }
        return from.containsKey("resourceFieldRef") ? "1" : "stand-in";
    }

    @SuppressWarnings("unchecked")
    static String readinessPath(Map<String, Object> container) {
        Map<String, Object> probe = (Map<String, Object>) container.get("readinessProbe");
        Map<String, Object> get = probe == null ? null : (Map<String, Object>) probe.get("httpGet");
        return get == null || get.get("path") == null ? "/" : String.valueOf(get.get("path"));
    }

    /** {@code java -jar} on the artifact the Quarkus build describes in target/. */
    static List<String> launchCommand() throws IOException {
        Path descriptor = TARGET.resolve("quarkus-artifact.properties");
        if (!Files.exists(descriptor)) {
            fail(descriptor + " is missing: package the application first (mvn verify does)");
        }
        Properties artifact = new Properties();
        try (InputStream in = Files.newInputStream(descriptor)) {
            artifact.load(in);
        }
        if (!"jar".equals(artifact.getProperty("type"))) {
            fail("RolloutEnvIT starts the packaged jar; this build produced a " + artifact.getProperty("type"));
        }
        String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
        return List.of(java, "-jar", TARGET.resolve(artifact.getProperty("path")).toString());
    }

    HttpServer startCollector() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            if ("gzip".equalsIgnoreCase(exchange.getRequestHeaders().getFirst("Content-Encoding"))) {
                body = new GZIPInputStream(new ByteArrayInputStream(body)).readAllBytes();
            }
            received.computeIfAbsent(exchange.getRequestURI().getPath(), p -> new CopyOnWriteArrayList<>()).add(body);
            exchange.getResponseHeaders().set("Content-Type", "application/x-protobuf");
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        return server;
    }

    /** An export to {@code path} whose payload names the service (protobuf keeps strings as UTF-8). */
    boolean carries(String path, String service) {
        return received.getOrDefault(path, List.of()).stream()
                .anyMatch(body -> new String(body, StandardCharsets.ISO_8859_1).contains(service));
    }

    static void awaitReady(Process app, URI probe, Path log) throws Exception {
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build();
        long deadline = System.nanoTime() + STARTUP.toNanos();
        while (System.nanoTime() < deadline) {
            if (!app.isAlive()) {
                fail("the application exited with code " + app.exitValue()
                        + " before it became ready on " + probe + "\n" + tail(log));
            }
            try {
                int status = http.send(HttpRequest.newBuilder(probe).timeout(Duration.ofSeconds(5)).build(),
                        HttpResponse.BodyHandlers.discarding()).statusCode();
                if (status >= 200 && status < 400) {
                    return;
                }
            } catch (IOException notListeningYet) {
                // keep polling
            }
            Thread.sleep(500);
        }
        fail("the application was not ready on " + probe + " within " + STARTUP + "\n" + tail(log));
    }

    static void await(BooleanSupplier condition, Duration timeout, Supplier<String> message)
            throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!condition.getAsBoolean()) {
            if (System.nanoTime() > deadline) {
                fail(message.get());
            }
            Thread.sleep(500);
        }
    }

    static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0, 0, InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        }
    }

    /** The errors and their causes (a stack trace buries them), then the last lines. */
    static String tail(Path log) {
        try {
            List<String> lines = Files.readAllLines(log);
            List<String> errors = lines.stream()
                    .filter(l -> l.contains(" ERROR ") || l.startsWith("Caused by:"))
                    .limit(20).toList();
            return "--- " + log + ": errors ---\n" + String.join("\n", errors)
                    + "\n--- last 20 lines ---\n"
                    + String.join("\n", lines.subList(Math.max(0, lines.size() - 20), lines.size()));
        } catch (IOException e) {
            return "(no output: " + e.getMessage() + ")";
        }
    }
}
