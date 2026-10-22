package io.adhar.service.web;

import java.net.URI;

import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.server.ServerWebExchange;

import io.github.resilience4j.bulkhead.BulkheadFullException;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import io.micrometer.core.instrument.MeterRegistry;

/**
 * Where a route's circuit breaker sends a request it will not, or could not,
 * pass upstream ({@code fallbackUri: forward:/fallback/<route>}).
 *
 * <p>Fails fast and says why, as a problem response: {@code 503} with
 * {@code Retry-After} while the breaker is open (the upstream is known to be
 * failing, so no call was made) or the route is at
 * {@code gateway.max-concurrent-per-route}; the upstream's own status when it answered with
 * one of the route's {@code statusCodes}; {@code 504} when it took longer than the
 * route's timeout; {@code 502} when it could not be reached. Counted as
 * {@code gateway_fallbacks_total{route, reason}}.
 *
 * <p>Replace a route's fallback with something more useful where there is one —
 * a cached response, a default, a degraded payload — by pointing its
 * {@code fallbackUri} at your own handler.
 */
@RestController
class FallbackController {

    private final MeterRegistry meters;

    FallbackController(MeterRegistry meters) {
        this.meters = meters;
    }

    @RequestMapping("/fallback/{route}")
    ResponseEntity<ProblemDetail> fallback(@PathVariable String route, ServerWebExchange exchange) {
        Throwable cause = exchange.getAttribute(ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR);
        HttpStatusCode status;
        String reason;
        String detail;
        if (cause instanceof BulkheadFullException) {
            status = HttpStatus.SERVICE_UNAVAILABLE;
            reason = "route-at-capacity";
            detail = "Too many requests are in progress to this upstream. Retry shortly.";
        } else if (cause instanceof CallNotPermittedException) {
            status = HttpStatus.SERVICE_UNAVAILABLE;
            reason = "circuit-open";
            detail = "The upstream service is failing; requests are paused while it recovers.";
        } else if (cause instanceof HttpStatusCodeException upstream) {
            // The upstream answered with one of the route's statusCodes.
            status = upstream.getStatusCode();
            reason = "upstream-" + status.value();
            detail = "The upstream service is unavailable.";
        } else if (ProblemDetailsErrorHandler.statusOf(cause).value() == HttpStatus.GATEWAY_TIMEOUT.value()) {
            status = HttpStatus.GATEWAY_TIMEOUT;
            reason = "timeout";
            detail = "The upstream service did not respond in time.";
        } else {
            status = HttpStatus.BAD_GATEWAY;
            reason = "upstream-error";
            detail = "The upstream service could not be reached.";
        }
        meters.counter("gateway.fallbacks", "route", route, "reason", reason).increment();

        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setInstance(URI.create(exchange.getRequest().getPath().value()));
        problem.setProperty("route", route);
        Object requestId = exchange.getAttribute(RequestIdFilter.ATTRIBUTE);
        if (requestId != null) {
            problem.setProperty("requestId", requestId);
        }
        ResponseEntity.BodyBuilder response = ResponseEntity.status(status).contentType(MediaType.APPLICATION_PROBLEM_JSON);
        if (status.value() == HttpStatus.SERVICE_UNAVAILABLE.value()) {
            response.header(HttpHeaders.RETRY_AFTER, "5");
        }
        return response.body(problem);
    }
}
