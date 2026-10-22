package io.adhar.service.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.AuthorityUtils;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;

import reactor.core.publisher.Mono;

class IdentityPropagationFilterTest {

    private final IdentityPropagationFilter filter = new IdentityPropagationFilter();

    private final MockServerHttpRequest spoofed = MockServerHttpRequest.get("/api/x")
            .header("X-User-ID", "mallory").header("X-User-Roles", "admin").build();

    @Test
    void replacesClaimedIdentityWithTheVerifiedOne() {
        var caller = UsernamePasswordAuthenticationToken.authenticated("alice", null,
                AuthorityUtils.createAuthorityList("ROLE_orders-read", "SCOPE_openid", "ROLE_orders-write"));

        ServerHttpRequest upstream = forward(Mono.just(caller));

        assertThat(upstream.getHeaders().getFirst("X-User-ID")).isEqualTo("alice");
        assertThat(upstream.getHeaders().getFirst("X-User-Roles")).isEqualTo("orders-read,orders-write");
    }

    @Test
    void stripsClaimedIdentityFromAnonymousCallers() {
        var anonymous = new AnonymousAuthenticationToken("key", "anonymousUser",
                AuthorityUtils.createAuthorityList("ROLE_ANONYMOUS"));

        ServerHttpRequest upstream = forward(Mono.just(anonymous));

        assertThat(upstream.getHeaders().get("X-User-ID")).isNull();
        assertThat(upstream.getHeaders().get("X-User-Roles")).isNull();
    }

    @Test
    void stripsClaimedIdentityWhenThereIsNoSecurityContext() {
        AtomicReference<ServerHttpRequest> upstream = new AtomicReference<>();
        filter.filter(MockServerWebExchange.from(spoofed), ex -> {
            upstream.set(ex.getRequest());
            return Mono.empty();
        }).block();

        assertThat(upstream.get().getHeaders().get("X-User-ID")).isNull();
        assertThat(filter.getOrder()).isLessThan(0);
    }

    private ServerHttpRequest forward(Mono<? extends org.springframework.security.core.Authentication> caller) {
        AtomicReference<ServerHttpRequest> upstream = new AtomicReference<>();
        filter.filter(MockServerWebExchange.from(spoofed), ex -> {
            upstream.set(ex.getRequest());
            return Mono.empty();
        }).contextWrite(ReactiveSecurityContextHolder.withAuthentication(caller.block())).block();
        return upstream.get();
    }

    @Test
    void rolesHeaderIsEmptyForACallerWithoutRealmRoles() {
        var caller = UsernamePasswordAuthenticationToken.authenticated("svc", null, List.of());
        assertThat(forward(Mono.just(caller)).getHeaders().getFirst("X-User-Roles")).isEmpty();
    }
}
