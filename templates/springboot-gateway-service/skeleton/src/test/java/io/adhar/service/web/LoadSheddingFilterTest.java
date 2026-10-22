package io.adhar.service.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.WebFilterChain;

import io.adhar.service.config.GatewayProperties;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import reactor.test.StepVerifier;

class LoadSheddingFilterTest {

    private final SimpleMeterRegistry meters = new SimpleMeterRegistry();
    private final LoadSheddingFilter filter = new LoadSheddingFilter(properties(2), meters);

    @Test
    void shedsRequestsAboveTheCeilingAndAdmitsThemAgainOnceCapacityFrees() {
        Sinks.Empty<Void> hold = Sinks.empty();
        WebFilterChain held = exchange -> hold.asMono();

        // Two requests in flight, held open by the chain.
        filter.filter(exchange("/api/a"), held).subscribe();
        filter.filter(exchange("/api/b"), held).subscribe();
        assertThat(meters.get("gateway.requests.inflight").gauge().value()).isEqualTo(2);

        MockServerWebExchange third = exchange("/api/c");
        StepVerifier.create(filter.filter(third, ex -> Mono.empty())).verifyComplete();
        assertThat(third.getResponse().getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        assertThat(third.getResponse().getHeaders().getFirst("Retry-After")).isEqualTo("1");
        StepVerifier.create(third.getResponse().getBodyAsString())
                .assertNext(body -> assertThat(body).contains("\"status\":503")).verifyComplete();
        assertThat(meters.get("gateway.requests.shed").counter().count()).isEqualTo(1);

        // The held requests finish; the next one is admitted.
        hold.tryEmitEmpty();
        assertThat(meters.get("gateway.requests.inflight").gauge().value()).isZero();
        MockServerWebExchange fourth = exchange("/api/d");
        StepVerifier.create(filter.filter(fourth, ex -> Mono.empty())).verifyComplete();
        assertThat(fourth.getResponse().getStatusCode()).isNull();
    }

    @Test
    void neverShedsTheActuatorSoASaturatedReplicaStillAnswersItsProbes() {
        Sinks.Empty<Void> hold = Sinks.empty();
        filter.filter(exchange("/api/a"), ex -> hold.asMono()).subscribe();
        filter.filter(exchange("/api/b"), ex -> hold.asMono()).subscribe();

        MockServerWebExchange probe = exchange("/actuator/health/readiness");
        StepVerifier.create(filter.filter(probe, ex -> Mono.empty())).verifyComplete();
        assertThat(probe.getResponse().getStatusCode()).isNull();
    }

    @Test
    void aCancelledRequestReleasesItsSlot() {
        filter.filter(exchange("/api/a"), ex -> Mono.never()).timeout(Duration.ofMillis(10))
                .onErrorResume(error -> Mono.empty()).block();
        assertThat(meters.get("gateway.requests.inflight").gauge().value()).isZero();
    }

    private static MockServerWebExchange exchange(String path) {
        return MockServerWebExchange.from(MockServerHttpRequest.get(path));
    }

    static GatewayProperties properties(int maxInFlight) {
        return new GatewayProperties(maxInFlight, 1000, Duration.ofSeconds(5), new GatewayProperties.Cors(List.of()),
                new GatewayProperties.CircuitBreaker(50, 100, 20, Duration.ofSeconds(10), 10));
    }
}
