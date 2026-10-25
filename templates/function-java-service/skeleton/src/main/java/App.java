import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.time.Instant;

public final class App {
  private App() {}

  public static void main(String[] args) throws IOException {
    int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));
    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.createContext("/healthz", new JsonHandler("{\"ok\":true,\"at\":\"%s\"}"));
    server.createContext("/", exchange -> {
      String functionName = env("FUNCTION_NAME", "${{ values.name }}");
      String trigger = env("FUNCTION_TRIGGER", "${{ values.trigger }}");
      String body = "{\"ok\":true,\"function\":\"%s\",\"runtime\":\"custom\",\"trigger\":\"%s\",\"at\":\"%s\"}"
          .formatted(escape(functionName), escape(trigger), Instant.now());
      writeJson(exchange, 200, body);
    });
    server.setExecutor(null);
    server.start();
    System.out.println("function listening on " + port);
  }

  private static String env(String key, String fallback) {
    String v = System.getenv(key);
    return (v == null || v.isBlank()) ? fallback : v;
  }

  private static String escape(String in) {
    return in.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static void writeJson(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes();
    exchange.getResponseHeaders().set("content-type", "application/json; charset=utf-8");
    exchange.sendResponseHeaders(status, bytes.length);
    try (OutputStream os = exchange.getResponseBody()) {
      os.write(bytes);
    }
  }

  private record JsonHandler(String template) implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
      writeJson(exchange, 200, template.formatted(Instant.now()));
    }
  }
}
