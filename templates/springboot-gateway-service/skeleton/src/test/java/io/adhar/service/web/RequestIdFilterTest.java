package io.adhar.service.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;

import reactor.core.publisher.Mono;

class RequestIdFilterTest {

    private final RequestIdFilter filter = new RequestIdFilter();

    @Test
    void generatesAnIdAndSendsItUpstreamAndBack() {
        AtomicReference<ServerHttpRequest> upstream = new AtomicReference<>();
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/x"));

        filter.filter(exchange, ex -> {
            upstream.set(ex.getRequest());
            return Mono.empty();
        }).block();

        String id = exchange.getResponse().getHeaders().getFirst("X-Request-ID");
        assertThat(id).matches("[0-9a-f-]{36}");
        assertThat(upstream.get().getHeaders().getFirst("X-Request-ID")).isEqualTo(id);
        assertThat(upstream.get().getHeaders().getFirst("X-Correlation-ID")).isEqualTo(id);
        assertThat((String) exchange.getAttribute(RequestIdFilter.ATTRIBUTE)).isEqualTo(id);
    }

    @Test
    void keepsAWellFormedIdAndTheCallersCorrelationId() {
        AtomicReference<ServerHttpRequest> upstream = new AtomicReference<>();
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/x")
                .header("X-Request-ID", "client-request-42").header("X-Correlation-ID", "journey-7"));

        filter.filter(exchange, ex -> {
            upstream.set(ex.getRequest());
            return Mono.empty();
        }).block();

        assertThat(exchange.getResponse().getHeaders().getFirst("X-Request-ID")).isEqualTo("client-request-42");
        assertThat(upstream.get().getHeaders().getFirst("X-Correlation-ID")).isEqualTo("journey-7");
    }

    @Test
    void replacesAnIdThatCouldForgeLogLines() {
        MockServerWebExchange exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/x")
                .header("X-Request-ID", "abc def <script>"));

        filter.filter(exchange, ex -> Mono.empty()).block();

        assertThat(exchange.getResponse().getHeaders().getFirst("X-Request-ID")).matches("[0-9a-f-]{36}");
    }
}
