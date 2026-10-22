package io.adhar.service.web;

import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;

import com.adhar.kit.commons.constant.CommonConstants;

import reactor.core.publisher.Mono;

/**
 * Gives every request an ID that the caller, the gateway's logs and every
 * upstream see — the first thing to ask for when someone reports a failed call.
 *
 * <p>A well-formed {@code X-Request-ID} from the caller is kept, so a request can
 * be followed from the client; anything else is replaced, so a caller cannot
 * inject a 10 KB header or a log-forging newline. The ID is forwarded upstream,
 * returned on the response, and also set as {@code X-Correlation-ID} when the
 * caller did not send one. Header names are Adhar Kit's
 * ({@link CommonConstants}), which every Adhar service reads.
 *
 * <p>Runs first, so even a request refused by authentication or load shedding
 * carries an ID.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter implements WebFilter {

    /** Exchange attribute holding the request's ID. */
    public static final String ATTRIBUTE = RequestIdFilter.class.getName() + ".id";

    private static final Pattern WELL_FORMED = Pattern.compile("[A-Za-z0-9._:-]{8,128}");

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String incoming = request.getHeaders().getFirst(CommonConstants.HEADER_REQUEST_ID);
        String id = incoming != null && WELL_FORMED.matcher(incoming).matches()
                ? incoming : UUID.randomUUID().toString();
        boolean hasCorrelation = request.getHeaders().containsHeader(CommonConstants.HEADER_CORRELATION_ID);

        ServerHttpRequest tagged = request.mutate().headers(headers -> {
            headers.set(CommonConstants.HEADER_REQUEST_ID, id);
            if (!hasCorrelation) {
                headers.set(CommonConstants.HEADER_CORRELATION_ID, id);
            }
        }).build();
        exchange.getAttributes().put(ATTRIBUTE, id);
        exchange.getResponse().getHeaders().set(CommonConstants.HEADER_REQUEST_ID, id);
        return chain.filter(exchange.mutate().request(tagged).build());
    }
}
