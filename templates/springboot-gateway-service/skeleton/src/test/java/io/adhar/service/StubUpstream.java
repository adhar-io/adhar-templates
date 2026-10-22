package io.adhar.service;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

/**
 * The service behind the gateway in the integration tests: a plain JDK HTTP
 * server with one path per behaviour the gateway has to handle.
 *
 * <pre>
 *   /echo/**          200, and what the upstream received (path, identity, IDs)
 *   /slow             answers after 3 s — longer than the tests' upstream timeout
 *   /unavailable      503, every time
 *   /error            500 with the service's own body
 *   /flaky/{id}       503 twice, then 200 — per id, so a retry can be observed
 * </pre>
 *
 * Each request gets its own virtual thread, so a slow call never holds up the
 * others.
 */
final class StubUpstream {

    private static final HttpServer SERVER = start();
    private static final Map<String, AtomicInteger> FLAKY = new ConcurrentHashMap<>();

    private StubUpstream() {
    }

    static String url() {
        return "http://127.0.0.1:" + SERVER.getAddress().getPort();
    }

    private static HttpServer start() {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
            server.createContext("/", StubUpstream::handle);
            server.start();
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void handle(HttpExchange exchange) throws IOException {
        String received = exchange.getRequestURI().getPath();
{%- if values.stripPrefix %}
        String path = received;
{%- else %}
        // The route forwards ${{ values.routePath }} unchanged; the test-only routes strip theirs.
        String path = received.startsWith("${{ values.routePath }}/")
                ? received.substring("${{ values.routePath }}".length()) : received;
{%- endif %}
        try (exchange) {
            if (path.startsWith("/echo")) {
                var headers = exchange.getRequestHeaders();
                respond(exchange, 200, """
                        {"path":"%s","method":"%s","userId":"%s","roles":"%s","requestId":"%s",\
                        "correlationId":"%s","authorization":%s}"""
                        .formatted(received, exchange.getRequestMethod(), value(headers.getFirst("X-User-ID")),
                                value(headers.getFirst("X-User-Roles")), value(headers.getFirst("X-Request-ID")),
                                value(headers.getFirst("X-Correlation-ID")),
                                headers.getFirst("Authorization") != null));
            } else if (path.equals("/slow")) {
                Thread.sleep(3_000);
                respond(exchange, 200, "{\"slow\":true}");
            } else if (path.equals("/unavailable")) {
                respond(exchange, 503, "{\"upstream\":\"unavailable\"}");
            } else if (path.equals("/error")) {
                respond(exchange, 500, "{\"upstream\":\"its own error\"}");
            } else if (path.startsWith("/flaky/")) {
                int attempt = FLAKY.computeIfAbsent(path, key -> new AtomicInteger()).incrementAndGet();
                respond(exchange, attempt <= 2 ? 503 : 200, "{\"attempt\":" + attempt + "}");
            } else {
                respond(exchange, 404, "{\"upstream\":\"not found\"}");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static String value(String header) {
        return header == null ? "" : header.replace("\"", "");
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
