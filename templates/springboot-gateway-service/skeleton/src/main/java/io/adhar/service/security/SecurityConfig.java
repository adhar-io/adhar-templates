package io.adhar.service.security;

{% if values.withAuth -%}
import java.util.ArrayList;
import java.util.Collection;
{% endif -%}
import java.util.List;
{%- if values.withAuth %}
import java.util.Map;
import java.util.stream.Stream;
{%- endif %}

{% if values.withAuth -%}
import org.springframework.beans.factory.annotation.Value;
{% endif -%}
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
{%- if values.withAuth %}
import org.springframework.core.convert.converter.Converter;
{%- endif %}
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
{%- if values.withAuth %}
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.oauth2.server.resource.authentication.ReactiveJwtAuthenticationConverterAdapter;
{%- endif %}
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.web.server.context.NoOpServerSecurityContextRepository;
import org.springframework.security.web.server.savedrequest.NoOpServerRequestCache;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;

import io.adhar.service.config.GatewayProperties;

/**
 * Who may call the gateway, as a reactive {@link SecurityWebFilterChain}.
 *
 * <p>The property names are Adhar Kit's ({@code adhar.security.*}), so a gateway
 * and the Spring services behind it are configured the same way. The kit's own
 * security module is servlet-based and cannot run in a WebFlux gateway; this
 * class is its reactive equivalent for what a gateway needs.
 *
 * <p>Stateless: no session, no saved request, no CSRF token — every request
 * carries its own credentials, so any replica can serve any request.
 */
@Configuration(proxyBeanMethods = false)
@EnableWebFluxSecurity
class SecurityConfig {

    /** Kubernetes probes and the platform's Prometheus cannot authenticate. */
    private static final String[] PLATFORM_ENDPOINTS = {
        "/actuator/health", "/actuator/health/**", "/actuator/info", "/actuator/prometheus"
    };

    /** Role that may read the gateway's own actuator endpoints (routes, breakers). */
    static final String ADMIN_ROLE = "gateway-admin";

    @Bean
    SecurityWebFilterChain gatewaySecurity(ServerHttpSecurity http, AuthorizationProperties authorization) {
        http.csrf(ServerHttpSecurity.CsrfSpec::disable)
                .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .logout(ServerHttpSecurity.LogoutSpec::disable)
                .requestCache(cache -> cache.requestCache(NoOpServerRequestCache.getInstance()))
                .securityContextRepository(NoOpServerSecurityContextRepository.getInstance())
                // CORS before authentication, so a browser's preflight (which
                // never carries a token) is answered rather than refused.
                .cors(cors -> { })
                .authorizeExchange(exchanges -> {
                    exchanges.pathMatchers(HttpMethod.OPTIONS).permitAll();
                    exchanges.pathMatchers(PLATFORM_ENDPOINTS).permitAll();
                    // The gateway's own actuator (routes, circuit breakers) BEFORE
                    // any configured rule, so a broad permit-all pattern can never
                    // open it. Rules match in order; the first match decides.
{%- if values.withAuth %}
                    exchanges.pathMatchers("/actuator/**").hasRole(ADMIN_ROLE);
{%- else %}
                    exchanges.pathMatchers("/actuator/**").denyAll();
{%- endif %}
                    if (!authorization.permitAll().isEmpty()) {
                        exchanges.pathMatchers(authorization.permitAll().toArray(String[]::new)).permitAll();
                    }
                    // Route-level authorization: adhar.security.authorization.authorities
                    // maps a path pattern to the roles that may call it.
                    authorization.authorities().forEach((path, roles) ->
                            exchanges.pathMatchers(path).hasAnyAuthority(roles.toArray(String[]::new)));
{%- if values.withAuth %}
                    exchanges.anyExchange().authenticated();
{%- else %}
                    // Authentication is off: everything else is open.
                    exchanges.anyExchange().permitAll();
{%- endif %}
                });
{%- if values.withAuth %}
        http.oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt -> jwt.jwtAuthenticationConverter(
                new ReactiveJwtAuthenticationConverterAdapter(keycloakAuthentication()))));
{%- endif %}
        return http.build();
    }
{%- if values.withAuth %}

    /**
     * Validates Keycloak's tokens against the realm's signing keys. The key set is
     * fetched once and cached, and refetched when a token names a key it does not
     * know — so Keycloak rotating its keys needs no restart, and validating a
     * token costs no network call.
     */
    @Bean
    ReactiveJwtDecoder jwtDecoder(@Value("${adhar.security.jwt.jwk-set-uri}") String jwkSetUri) {
        return NimbusReactiveJwtDecoder.withJwkSetUri(jwkSetUri).build();
    }

    /**
     * Keycloak puts realm roles in {@code realm_access.roles}; each becomes
     * {@code ROLE_<role>}, next to the token's scopes as {@code SCOPE_<scope>}.
     * The principal's name is the subject, which is what the rate limiter keys
     * on and what reaches the upstream as X-User-ID.
     */
    static JwtAuthenticationConverter keycloakAuthentication() {
        JwtGrantedAuthoritiesConverter scopes = new JwtGrantedAuthoritiesConverter();
        Converter<Jwt, Collection<GrantedAuthority>> authorities = jwt -> {
            Collection<GrantedAuthority> granted = new ArrayList<>(scopes.convert(jwt));
            realmRoles(jwt).map(role -> new SimpleGrantedAuthority("ROLE_" + role)).forEach(granted::add);
            return granted;
        };
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(authorities);
        return converter;
    }

    private static Stream<String> realmRoles(Jwt jwt) {
        if (jwt.getClaim("realm_access") instanceof Map<?, ?> realm
                && realm.get("roles") instanceof Collection<?> roles) {
            return roles.stream().map(String::valueOf);
        }
        return Stream.empty();
    }
{%- endif %}

    /**
     * Allowed browser origins ({@code gateway.cors.allowed-origins}). Credentials
     * are allowed, so origins are matched exactly — never a wildcard — and the
     * preflight answer is cached by the browser for an hour.
     */
    @Bean
    CorsConfigurationSource corsConfigurationSource(GatewayProperties gateway) {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        List<String> origins = gateway.cors().allowedOrigins().stream().map(String::trim)
                .filter(origin -> !origin.isEmpty()).toList();
        if (!origins.isEmpty()) {
            CorsConfiguration cors = new CorsConfiguration();
            cors.setAllowedOrigins(origins);
            cors.setAllowedMethods(List.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
            cors.setAllowedHeaders(List.of("*"));
            cors.setExposedHeaders(List.of("X-Request-ID", "Retry-After",
                    "X-RateLimit-Remaining", "X-RateLimit-Replenish-Rate", "X-RateLimit-Burst-Capacity"));
            cors.setAllowCredentials(true);
            cors.setMaxAge(3600L);
            source.registerCorsConfiguration("/**", cors);
        }
        return source;
    }
}
