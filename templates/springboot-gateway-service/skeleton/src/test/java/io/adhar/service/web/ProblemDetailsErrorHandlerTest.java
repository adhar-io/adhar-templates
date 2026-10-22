package io.adhar.service.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ConnectException;
import java.net.UnknownHostException;
import java.util.concurrent.TimeoutException;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.codec.ServerCodecConfigurer;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.ResponseStatusException;

class ProblemDetailsErrorHandlerTest {

    @Test
    void classifiesUpstreamFailures() {
        assertThat(ProblemDetailsErrorHandler.statusOf(new ConnectException("refused")))
                .isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(ProblemDetailsErrorHandler.statusOf(new RuntimeException(new UnknownHostException("orders"))))
                .isEqualTo(HttpStatus.BAD_GATEWAY);
        assertThat(ProblemDetailsErrorHandler.statusOf(new TimeoutException()))
                .isEqualTo(HttpStatus.GATEWAY_TIMEOUT);
        assertThat(ProblemDetailsErrorHandler.statusOf(new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE)))
                .isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(ProblemDetailsErrorHandler.statusOf(new IllegalStateException("bug")))
                .isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
    }

    @Test
    void answersAProblemWithoutLeakingTheCause() {
        var handler = new ProblemDetailsErrorHandler(ServerCodecConfigurer.create());
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/orders"));
        exchange.getAttributes().put(RequestIdFilter.ATTRIBUTE, "req-12345678");

        handler.handle(exchange, new IllegalStateException("password=hunter2")).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        String body = exchange.getResponse().getBodyAsString().block();
        assertThat(body).contains("\"requestId\":\"req-12345678\"", "\"instance\":\"/api/orders\"")
                .doesNotContain("hunter2");
    }
}
