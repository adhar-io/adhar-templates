package io.adhar.service.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;

import org.junit.jupiter.api.Test;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;

class CallerKeyResolverTest {

    private final CallerKeyResolver resolver = new CallerKeyResolver();

    @Test
    void anAuthenticatedCallerIsLimitedByIdentity() {
        var caller = UsernamePasswordAuthenticationToken.authenticated("alice", null, AuthorityUtils.NO_AUTHORITIES);
        var exchange = MockServerWebExchange.builder(MockServerHttpRequest.get("/api/x")).principal(caller).build();

        assertThat(resolver.resolve(exchange).block()).isEqualTo("user:alice");
    }

    @Test
    void anAnonymousCallerIsLimitedByTheAddressThePlatformGatewaySaw() {
        // The client claimed 1.2.3.4; the platform Gateway appended the real address.
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/x")
                .header("X-Forwarded-For", "1.2.3.4, 198.51.100.23")
                .remoteAddress(new InetSocketAddress("10.0.0.5", 41000)));

        assertThat(resolver.resolve(exchange).block()).isEqualTo("ip:198.51.100.23");
    }

    @Test
    void withoutForwardingHeadersTheConnectionsAddressIsUsed() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/x")
                .remoteAddress(new InetSocketAddress("10.0.0.5", 41000)));

        assertThat(resolver.resolve(exchange).block()).isEqualTo("ip:10.0.0.5");
    }
}
