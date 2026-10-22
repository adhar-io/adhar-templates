package io.adhar.service;

import java.util.Set;

import org.springframework.boot.test.context.TestConfiguration;
{%- if values.withRateLimit %}
import org.springframework.cloud.gateway.filter.ratelimit.RedisRateLimiter;
{%- endif %}
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
{%- if values.withRateLimit %}

import io.adhar.service.ratelimit.CallerKeyResolver;
{%- endif %}

/**
 * Routes that exist only in the tests, beside the ones in application.yaml, for
 * behaviour that needs its own small limits to be observed in a few requests
 * without affecting the real route the other scenarios use.
 *
 * <ul>
 *   <li>{@code /it-breaker/**} — a circuit breaker named {@code it-breaker},
 *       tuned on its own ({@code resilience4j.circuitbreaker.instances.it-breaker.*}
 *       in {@link ApiIT}), which proves per-route breaker configuration reaches
 *       the gateway's breakers.</li>
{%- if values.withRateLimit %}
 *   <li>{@code /it-limited/**} — the same Valkey rate limiter and caller key as
 *       the real route, with a bucket of three.</li>
{%- endif %}
 * </ul>
 */
@TestConfiguration(proxyBeanMethods = false)
class TestRoutes {

    @Bean
    RouteLocator testRoutes(RouteLocatorBuilder routes{% if values.withRateLimit %}, CallerKeyResolver callerKeyResolver{% endif %}) {
        return routes.routes()
                .route("it-breaker", route -> route.path("/it-breaker/**")
                        .filters(f -> f.stripPrefix(1).circuitBreaker(cb -> cb.setName("it-breaker")
                                .setFallbackUri("forward:/fallback/it-breaker")
                                .setStatusCodes(Set.of("503"))))
                        .uri(StubUpstream.url()))
{%- if values.withRateLimit %}
                .route("it-limited", route -> route.path("/it-limited/**")
                        .filters(f -> f.requestRateLimiter()
                                .rateLimiter(RedisRateLimiter.class, limit -> limit.setReplenishRate(1).setBurstCapacity(3))
                                .configure(limiter -> limiter.setKeyResolver(callerKeyResolver))
                                .stripPrefix(1))
                        .uri(StubUpstream.url()))
{%- endif %}
                .build();
    }
}
