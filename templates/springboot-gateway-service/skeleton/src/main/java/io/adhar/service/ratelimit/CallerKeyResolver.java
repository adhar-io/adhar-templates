package io.adhar.service.ratelimit;

import java.net.InetSocketAddress;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.cloud.gateway.support.ipresolver.XForwardedRemoteAddressResolver;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;

import reactor.core.publisher.Mono;

/**
 * Who a request counts against, for rate limiting ({@code #{@callerKeyResolver}}).
 *
 * <p>An authenticated caller is limited by identity — the token's subject — so a
 * user is one bucket however many addresses they call from, and many users
 * behind one corporate NAT do not share a bucket. An anonymous caller is
 * limited by client IP.
 *
 * <p>The IP is the one the platform's Gateway saw: the LAST entry of
 * {@code X-Forwarded-For}, which that proxy appends. Earlier entries are
 * whatever the client claimed and are ignored — trusting the first one would let
 * a caller pick a fresh identity, and a fresh bucket, on every request.
 */
@Component("callerKeyResolver")
public class CallerKeyResolver implements KeyResolver {

    private final XForwardedRemoteAddressResolver clientAddress = XForwardedRemoteAddressResolver.maxTrustedIndex(1);

    @Override
    public Mono<String> resolve(ServerWebExchange exchange) {
        return exchange.getPrincipal()
                .filter(principal -> !(principal instanceof AnonymousAuthenticationToken)
                        && (!(principal instanceof Authentication auth) || auth.isAuthenticated()))
                .map(principal -> "user:" + principal.getName())
                .switchIfEmpty(Mono.fromSupplier(() -> "ip:" + clientIp(exchange)));
    }

    private String clientIp(ServerWebExchange exchange) {
        InetSocketAddress address = clientAddress.resolve(exchange);
        if (address == null) {
            return "unknown";
        }
        return address.getAddress() != null ? address.getAddress().getHostAddress() : address.getHostString();
    }
}
