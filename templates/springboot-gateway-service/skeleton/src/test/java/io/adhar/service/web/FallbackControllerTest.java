package io.adhar.service.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ConnectException;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.Test;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.client.HttpServerErrorException;

import io.github.resilience4j.bulkhead.Bulkhead;
import io.github.resilience4j.bulkhead.BulkheadFullException;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

class FallbackControllerTest {

    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final FallbackController controller = new FallbackController(meters);

    @Test
    void anOpenBreakerIsA503WithRetryAfter() {
        var response = fallback(CallNotPermittedException.createCallNotPermittedException(CircuitBreaker.ofDefaults("orders")));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(response.getHeaders().getFirst("Retry-After")).isEqualTo("5");
        assertThat(response.getBody().getDetail()).contains("paused");
        assertThat(meters.get("gateway.fallbacks").tag("reason", "circuit-open").counter().count()).isEqualTo(1);
    }

    @Test
    void aFullRouteIsA503ThatSaysSo() {
        var response = fallback(BulkheadFullException.createBulkheadFullException(Bulkhead.ofDefaults("orders")));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(meters.get("gateway.fallbacks").tag("reason", "route-at-capacity").counter().count()).isEqualTo(1);
    }

    @Test
    void anUpstreamStatusIsKept() {
        var response = fallback(HttpServerErrorException.create(HttpStatus.BAD_GATEWAY, "bad", null, null, null));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(response.getHeaders().getFirst("Retry-After")).isNull();
    }

    @Test
    void aTimeoutIsA504AndAnythingElseA502() {
        assertThat(fallback(new TimeoutException()).getStatusCode()).isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
        assertThat(fallback(new ConnectException("refused")).getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(fallback(null).getStatusCode()).isEqualTo(HttpStatus.BAD_GATEWAY);
    }

    private ResponseEntity<ProblemDetail> fallback(Throwable cause) {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/orders"));
        if (cause != null) {
            exchange.getAttributes().put(ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR, cause);
        }
        exchange.getAttributes().put(RequestIdFilter.ATTRIBUTE, "req-12345678");
        ResponseEntity<ProblemDetail> response = controller.fallback("orders", exchange);
        assertThat(response.getBody().getProperties()).containsEntry("route", "orders").containsEntry("requestId", "req-12345678");
        return response;
    }
}
