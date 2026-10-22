package io.adhar.service.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * The gateway's own traffic policy ({@code gateway.*} in application.yaml).
 * Routing itself is Spring Cloud Gateway configuration
 * ({@code spring.cloud.gateway.server.webflux.*}); these are the protections
 * around it.
 *
 * @param maxInFlight     concurrent requests one replica serves before it sheds
 *                        load with 503 (see {@code LoadSheddingFilter})
 * @param maxConcurrentPerRoute concurrent calls one route may have open to its
 *                        upstream; beyond it the route answers 503 at once, so one
 *                        slow upstream cannot take every connection and slot the
 *                        replica has (a bulkhead per route)
 * @param upstreamTimeout longest one attempt waits for its upstream before the
 *                        gateway answers 504
 * @param cors            browser origins allowed to call the gateway
 * @param circuitBreaker  defaults for every route's circuit breaker; a route is
 *                        tuned on its own under {@code resilience4j.circuitbreaker.instances.<route>}
 */
@ConfigurationProperties("gateway")
public record GatewayProperties(
        @DefaultValue("2000") int maxInFlight,
        @DefaultValue("1000") int maxConcurrentPerRoute,
        @DefaultValue("5s") Duration upstreamTimeout,
        @DefaultValue Cors cors,
        @DefaultValue CircuitBreaker circuitBreaker) {

    /** @param allowedOrigins exact origins, e.g. https://app.example.com; empty allows none */
    public record Cors(@DefaultValue List<String> allowedOrigins) {
    }

    /**
     * Opens when {@code failureRateThreshold}% of the last {@code slidingWindowSize}
     * calls failed (5xx, connection errors or timeouts), once at least
     * {@code minimumNumberOfCalls} were made; stays open for {@code waitInOpenState},
     * then lets {@code permittedCallsInHalfOpenState} trial calls through.
     */
    public record CircuitBreaker(
            @DefaultValue("50") float failureRateThreshold,
            @DefaultValue("100") int slidingWindowSize,
            @DefaultValue("20") int minimumNumberOfCalls,
            @DefaultValue("10s") Duration waitInOpenState,
            @DefaultValue("10") int permittedCallsInHalfOpenState) {
    }
}
