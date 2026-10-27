package io.adhar.function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.sun.net.httpserver.HttpServer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The function's tests. `mvn verify` runs them, locally and in app-ci. */
class AppTest {
  private static HttpServer server;
  private static final HttpClient CLIENT = HttpClient.newHttpClient();

  @BeforeAll
  static void start() throws Exception {
    server = App.start(0);
  }

  @AfterAll
  static void stop() {
    server.stop(0);
  }

  private static HttpResponse<String> send(HttpRequest.Builder request) throws Exception {
    return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }

  private static URI uri(String path) {
    return URI.create("http://127.0.0.1:" + server.getAddress().getPort() + path);
  }

  @Test
  void healthzAnswersOk() throws Exception {
    HttpResponse<String> res = send(HttpRequest.newBuilder(uri("/healthz")));
    assertEquals(200, res.statusCode());
    assertTrue(res.body().contains("\"ok\":true"), res.body());
  }

  @Test
  void getInvokesTheFunction() throws Exception {
    HttpResponse<String> res = send(HttpRequest.newBuilder(uri("/")));
    assertEquals(200, res.statusCode());
    assertTrue(res.body().contains("\"event\":null"), res.body());
  }

  @Test
  void aCloudEventIsHandled() throws Exception {
    HttpResponse<String> res = send(HttpRequest.newBuilder(uri("/"))
        .header("content-type", "application/json")
        .header("ce-type", "com.example.ping")
        .header("ce-source", "test")
        .header("ce-id", "1")
        .header("ce-specversion", "1.0")
        .POST(HttpRequest.BodyPublishers.ofString("{\"hello\":\"world\"}")));
    assertEquals(200, res.statusCode());
    assertTrue(res.body().contains("\"event\":\"com.example.ping\""), res.body());
    assertTrue(res.body().contains("\"received\":17"), res.body());
  }
}
