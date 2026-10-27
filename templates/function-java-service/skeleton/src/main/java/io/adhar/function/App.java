package io.adhar.function;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.Executors;

/**
 * ${{ values.name }}: an HTTP function on Adhar's Function API (Knative).
 *
 * <p>Knative starts this process on demand, sends it requests on $PORT (8080) and
 * scales it to zero when no request has arrived for a while. Events from the
 * function's trigger arrive as HTTP POSTs too: a CloudEvent in binary mode (ce-*
 * headers) from a schedule or a Broker, or a Dapr topic delivery.
 */
public final class App {
  static final String NAME = env("FUNCTION_NAME", ${{ values.name | dump }});
  static final String RUNTIME = env("FUNCTION_RUNTIME", "java25");
  static final String TRIGGER = env("FUNCTION_TRIGGER", "http");
  /** Requests larger than this are refused rather than buffered. */
  static final int MAX_BODY = 1024 * 1024;

  private App() {}

  public static void main(String[] args) throws IOException {
    HttpServer server = start(Integer.parseInt(env("PORT", "8080")));
    // Knative sends SIGTERM before it scales an instance away: finish what is in
    // flight, then exit.
    Runtime.getRuntime().addShutdownHook(new Thread(() -> server.stop(5)));
    System.out.println("{\"level\":\"info\",\"msg\":\"listening\",\"function\":\"" + escape(NAME)
        + "\",\"port\":" + server.getAddress().getPort() + "}");
  }

  /** Serves the function on {@code port} (0 picks a free one) and returns the server. */
  public static HttpServer start(int port) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.createContext("/", App::handle);
    server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
    server.start();
    return server;
  }

  static void handle(HttpExchange exchange) throws IOException {
    try (exchange) {
      String path = exchange.getRequestURI().getPath();
      if ("GET".equals(exchange.getRequestMethod()) && "/healthz".equals(path)) {
        send(exchange, 200, "{\"ok\":true,\"at\":\"" + Instant.now() + "\"}");
        return;
      }
      byte[] body;
      try (InputStream in = exchange.getRequestBody()) {
        body = in.readNBytes(MAX_BODY + 1);
      }
      if (body.length > MAX_BODY) {
        send(exchange, 413, "{\"ok\":false,\"error\":\"request body too large\"}");
        return;
      }
      send(exchange, 200, invoke(exchange.getRequestMethod(), path,
          exchange.getRequestHeaders().getFirst("ce-type"), body));
    }
  }

  /** The function. Replace the body with what yours does. */
  static String invoke(String method, String path, String event, byte[] body) {
    return "{\"ok\":true"
        + ",\"function\":\"" + escape(NAME) + "\""
        + ",\"runtime\":\"" + escape(RUNTIME) + "\""
        + ",\"trigger\":\"" + escape(TRIGGER) + "\""
        + ",\"method\":\"" + escape(method) + "\""
        + ",\"path\":\"" + escape(path) + "\""
        + ",\"event\":" + (event == null ? "null" : "\"" + escape(event) + "\"")
        + ",\"received\":" + body.length
        + ",\"at\":\"" + Instant.now() + "\"}";
  }

  private static void send(HttpExchange exchange, int status, String json) throws IOException {
    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("content-type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream out = exchange.getResponseBody()) {
      out.write(bytes);
    }
  }

  static String env(String key, String fallback) {
    String v = System.getenv(key);
    return v == null || v.isBlank() ? fallback : v;
  }

  static String escape(String in) {
    StringBuilder out = new StringBuilder(in.length());
    for (char c : in.toCharArray()) {
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (c < 0x20) {
            out.append(String.format("\\u%04x", (int) c));
          } else {
            out.append(c);
          }
        }
      }
    }
    return out.toString();
  }
}
