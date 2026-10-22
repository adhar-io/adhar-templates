package io.adhar.service.web;

import java.net.ConnectException;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.TimeoutException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.webflux.error.ErrorWebExceptionHandler;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.codec.HttpMessageWriter;
import org.springframework.http.codec.ServerCodecConfigurer;
import org.springframework.stereotype.Component;
import org.springframework.web.ErrorResponse;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.reactive.result.view.ViewResolver;
import org.springframework.web.server.ServerWebExchange;

import reactor.core.publisher.Mono;

/**
 * Every error the gateway itself produces is an RFC 9457 problem
 * ({@code application/problem+json}) with the request's ID, so a client gets
 * the same shape for "no such route", "upstream down" and "upstream too slow".
 *
 * <p>Upstream failures are classified rather than reported as 500: a refused or
 * unresolvable connection is {@code 502 Bad Gateway}, an upstream that did not
 * answer in time is {@code 504 Gateway Timeout}. Details of 5xx errors are
 * logged, not returned — a stack trace or an internal hostname in a response is
 * a gift to an attacker. Errors an upstream returns itself pass through
 * untouched; this only sees the gateway's own.
 */
@Component
@Order(-2) // ahead of Spring Boot's default handler (-1)
public class ProblemDetailsErrorHandler implements ErrorWebExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ProblemDetailsErrorHandler.class);

    private final ServerResponse.Context context;

    public ProblemDetailsErrorHandler(ServerCodecConfigurer codecs) {
        List<HttpMessageWriter<?>> writers = codecs.getWriters();
        this.context = new ServerResponse.Context() {
            @Override
            public List<HttpMessageWriter<?>> messageWriters() {
                return writers;
            }

            @Override
            public List<ViewResolver> viewResolvers() {
                return List.of();
            }
        };
    }

    @Override
    public Mono<Void> handle(ServerWebExchange exchange, Throwable error) {
        if (exchange.getResponse().isCommitted()) {
            return Mono.error(error);
        }
        HttpStatusCode status = statusOf(error);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detailOf(error, status));
        problem.setInstance(URI.create(exchange.getRequest().getPath().value()));
        Object requestId = exchange.getAttribute(RequestIdFilter.ATTRIBUTE);
        if (requestId != null) {
            problem.setProperty("requestId", requestId);
        }
        if (status.is5xxServerError()) {
            log.warn("{} {} failed with {} (request {})", exchange.getRequest().getMethod(),
                    exchange.getRequest().getPath(), status.value(), requestId, error);
        }
        return ServerResponse.status(status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .bodyValue(problem)
                .flatMap(response -> response.writeTo(exchange, context));
    }

    static HttpStatusCode statusOf(Throwable error) {
        if (error instanceof ErrorResponse response) {
            return response.getStatusCode();
        }
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof TimeoutException
                    || cause instanceof org.springframework.cloud.gateway.support.TimeoutException) {
                return HttpStatus.GATEWAY_TIMEOUT;
            }
            if (cause instanceof ConnectException || cause instanceof UnknownHostException) {
                return HttpStatus.BAD_GATEWAY;
            }
        }
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }

    private static String detailOf(Throwable error, HttpStatusCode status) {
        if (status.value() == HttpStatus.BAD_GATEWAY.value()) {
            return "The upstream service could not be reached.";
        }
        if (status.value() == HttpStatus.GATEWAY_TIMEOUT.value()) {
            return "The upstream service did not respond in time.";
        }
        if (status.is4xxClientError() && error instanceof ErrorResponse response
                && response.getBody().getDetail() != null) {
            return response.getBody().getDetail();
        }
        return status.is5xxServerError() ? "The gateway could not complete the request." : null;
    }
}
