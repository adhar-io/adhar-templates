package io.adhar.service.config;

import java.time.Duration;

import org.springframework.cloud.circuitbreaker.resilience4j.ReactiveResilience4JCircuitBreakerFactory;
import org.springframework.cloud.circuitbreaker.resilience4j.ReactiveResilience4jBulkheadProvider;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4JConfigBuilder;
import org.springframework.cloud.circuitbreaker.resilience4j.Resilience4jBulkheadConfigurationBuilder;
import org.springframework.cloud.client.circuitbreaker.Customizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import io.github.resilience4j.bulkhead.BulkheadConfig;
import io.github.resilience4j.bulkhead.BulkheadFullException;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.timelimiter.TimeLimiterConfig;

/**
 * Defaults for the circuit breaker every route runs behind.
 *
 * <p>The breakers live in the application's one {@code CircuitBreakerRegistry},
 * which Spring Cloud's factory and Adhar Kit (adhar-kit-resilience) share: the
 * kit exports every breaker's state and calls as metrics, reports them in health
 * and records their events. A route tuned on its own under
 * {@code resilience4j.circuitbreaker.instances.<route>} gets that configuration;
 * every other route gets these defaults.
 *
 * <p>Not {@code adhar.resilience.circuit-breaker.<name>}: in Adhar Kit 0.1.0
 * those are read only by the kit's own registry, which steps aside when
 * Resilience4j's Spring Boot registry is present — as it is here, through Spring
 * Cloud CircuitBreaker — so they would be silently ignored.
 *
 * <p>Each attempt is bounded by the HTTP client's response timeout
 * ({@code gateway.upstream-timeout}); the breaker's time limit is twice that and
 * bounds the whole call, retries included. A call over it is cancelled — the
 * upstream connection is released, not left to finish into the void — and
 * counted as a failure towards opening the breaker.
 */
@Configuration(proxyBeanMethods = false)
class ResilienceConfig {

    @Bean
    Customizer<ReactiveResilience4JCircuitBreakerFactory> circuitBreakerDefaults(GatewayProperties gateway) {
        GatewayProperties.CircuitBreaker cb = gateway.circuitBreaker();
        return factory -> factory.configureDefault(id -> new Resilience4JConfigBuilder(id)
                .circuitBreakerConfig(CircuitBreakerConfig.custom()
                        .failureRateThreshold(cb.failureRateThreshold())
                        .slidingWindowSize(cb.slidingWindowSize())
                        .minimumNumberOfCalls(cb.minimumNumberOfCalls())
                        .waitDurationInOpenState(cb.waitInOpenState())
                        .permittedNumberOfCallsInHalfOpenState(cb.permittedCallsInHalfOpenState())
                        .automaticTransitionFromOpenToHalfOpenEnabled(true)
                        // A call that takes most of the timeout is a symptom too:
                        // a backend going slow trips the breaker before it times out.
                        .slowCallDurationThreshold(gateway.upstreamTimeout().multipliedBy(4).dividedBy(5))
                        .slowCallRateThreshold(80)
                        // A full bulkhead is this replica at capacity, not the
                        // upstream failing; it must not open the upstream's breaker.
                        .ignoreExceptions(BulkheadFullException.class)
                        .build())
                .timeLimiterConfig(TimeLimiterConfig.custom()
                        .timeoutDuration(gateway.upstreamTimeout().multipliedBy(2))
                        .cancelRunningFuture(true)
                        .build())
                .build());
    }

    /**
     * The bulkhead Spring Cloud puts around every route's breaker. Its Resilience4j
     * default is 25 concurrent calls — a gateway under real load rejects nearly
     * everything at that size, and the rejections open the breaker. Sized instead to
     * {@code gateway.max-concurrent-per-route}, the same as the route's connection
     * pool, and rejecting at once rather than queueing (the pool already queues).
     */
    @Bean
    Customizer<ReactiveResilience4jBulkheadProvider> bulkheadDefaults(GatewayProperties gateway) {
        return provider -> provider.configureDefault(id -> new Resilience4jBulkheadConfigurationBuilder()
                .bulkheadConfig(BulkheadConfig.custom()
                        .maxConcurrentCalls(gateway.maxConcurrentPerRoute())
                        .maxWaitDuration(Duration.ZERO)
                        .build())
                .build());
    }
}
