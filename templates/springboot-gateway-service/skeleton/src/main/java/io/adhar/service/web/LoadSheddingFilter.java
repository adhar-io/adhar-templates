package io.adhar.service.web;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;

import io.adhar.service.config.GatewayProperties;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import reactor.core.publisher.Mono;

/**
 * Load shedding: a hard ceiling on the requests one replica works on at once
 * ({@code gateway.max-in-flight}).
 *
 * <p>A reactive gateway does not run out of threads, so without a ceiling an
 * overload shows up as memory and latency instead: every request is accepted,
 * all of them slow down together, and they all time out. Refusing the excess
 * at once with {@code 503} and {@code Retry-After} keeps the requests already
 * admitted fast, tells well-behaved clients to back off, and gives the
 * autoscaler time to add replicas.
 *
 * <p>The actuator is exempt, so a saturated replica still answers its probes
 * and is not restarted for being busy. Exported as
 * {@code gateway_requests_inflight} and {@code gateway_requests_shed_total}.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class LoadSheddingFilter implements WebFilter {

    private static final byte[] BODY = ("{\"type\":\"about:blank\",\"title\":\"Service Unavailable\","
            + "\"status\":503,\"detail\":\"The gateway is at capacity. Retry shortly.\"}")
            .getBytes(StandardCharsets.UTF_8);

    private final AtomicInteger inFlight = new AtomicInteger();
    private final int maxInFlight;
    private final Counter shed;

    public LoadSheddingFilter(GatewayProperties gateway, MeterRegistry meters) {
        this.maxInFlight = gateway.maxInFlight();
        Gauge.builder("gateway.requests.inflight", inFlight, AtomicInteger::get)
                .description("Requests this replica is serving right now").register(meters);
        this.shed = Counter.builder("gateway.requests.shed")
                .description("Requests refused with 503 because the replica was at gateway.max-in-flight")
                .register(meters);
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        if (exchange.getRequest().getPath().value().startsWith("/actuator/")) {
            return chain.filter(exchange);
        }
        if (inFlight.incrementAndGet() > maxInFlight) {
            inFlight.decrementAndGet();
            shed.increment();
            return reject(exchange.getResponse());
        }
        return chain.filter(exchange).doFinally(signal -> inFlight.decrementAndGet());
    }

    private static Mono<Void> reject(ServerHttpResponse response) {
        response.setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
        response.getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
        response.getHeaders().set(HttpHeaders.RETRY_AFTER, "1");
        DataBuffer body = response.bufferFactory().wrap(BODY);
        return response.writeWith(Mono.just(body));
    }
}
