package io.adhar.service.web;

import java.util.stream.Collectors;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;

import com.adhar.kit.commons.constant.CommonConstants;

import reactor.core.publisher.Mono;

/**
 * Tells the upstream who is calling, in headers it can trust.
 *
 * <p>Any {@code X-User-ID} or {@code X-User-Roles} the client sent is removed —
 * otherwise anyone could claim to be anyone — and, for an authenticated caller,
 * set from the verified token: the subject, and the roles without their
 * {@code ROLE_} prefix. The bearer token itself is forwarded unchanged, so an
 * upstream that validates it (any Adhar Kit service with security on) still can.
 *
 * <p>Services behind the gateway should only be reachable through it for these
 * headers to mean anything; see docs/architecture.md.
 */
@Component
public class IdentityPropagationFilter implements GlobalFilter, Ordered {

    static final String ROLES_HEADER = "X-User-Roles";
    private static final String ROLE_PREFIX = "ROLE_";

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        return ReactiveSecurityContextHolder.getContext()
                .map(SecurityContext::getAuthentication)
                .filter(auth -> auth.isAuthenticated() && !(auth instanceof AnonymousAuthenticationToken))
                .map(auth -> withIdentity(exchange.getRequest(), auth))
                .defaultIfEmpty(withIdentity(exchange.getRequest(), null))
                .flatMap(request -> chain.filter(exchange.mutate().request(request).build()));
    }

    static ServerHttpRequest withIdentity(ServerHttpRequest request, Authentication caller) {
        return request.mutate().headers(headers -> {
            headers.remove(CommonConstants.HEADER_USER_ID);
            headers.remove(ROLES_HEADER);
            if (caller != null) {
                headers.set(CommonConstants.HEADER_USER_ID, caller.getName());
                headers.set(ROLES_HEADER, caller.getAuthorities().stream()
                        .map(GrantedAuthority::getAuthority)
                        .filter(authority -> authority.startsWith(ROLE_PREFIX))
                        .map(authority -> authority.substring(ROLE_PREFIX.length()))
                        .collect(Collectors.joining(",")));
            }
        }).build();
    }

    /** Early in the gateway chain, before the request is sent upstream. */
    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 10;
    }
}
