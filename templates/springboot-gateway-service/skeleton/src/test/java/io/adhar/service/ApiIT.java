package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;

{% if values.withAuth -%}
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.List;
import java.util.Map;

{% endif -%}
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

{% if values.withAuth -%}
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpServer;
{% endif -%}
import com.intuit.karate.Results;
import com.intuit.karate.junit5.Karate;

/**
 * API integration tests: the Karate features in {@code src/test/resources/karate}
 * run against the real gateway, started on a random port in front of
 * {@link StubUpstream}{% if values.withRateLimit %}, with a Testcontainers Valkey for the rate limiter{% endif %}.
 *
 * <p>Run with {@code mvn verify} — failsafe picks up {@code *IT} classes, so
 * {@code mvn test} stays a fast unit-test run. Needs a Docker API: a local Docker
 * or Podman socket, or in CI a kubedock sidecar
 * ({@code DOCKER_HOST=tcp://127.0.0.1:2475}, {@code TESTCONTAINERS_RYUK_DISABLED=true}).
{%- if values.withAuth %}
 *
 * <p>The gateway requires a Keycloak JWT. Rather than start Keycloak, the test
 * plays its part: it signs tokens with its own RSA key and serves the public half
 * as a JWKS that {@code adhar.security.jwt.jwk-set-uri} points at, so tokens go
 * through the gateway's real validation path. Features mint their own with
 * {@code Java.type('io.adhar.service.ApiIT').token(subject, roles)}.
{%- endif %}
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    // No telemetry export from a test run: there is no collector, and resolving
    // the in-cluster one's name outside the cluster stalls the run for a minute.
    "adhar.tracing.open-telemetry.enabled=false",
    "management.otlp.metrics.export.enabled=false",
    // Short enough that the timeout scenario runs in a second.
    "gateway.upstream-timeout=1s",
    "gateway.cors.allowed-origins=https://app.example.test",
    // The test-only breaker (TestRoutes), tuned on its own the way a route is
    // in application.yaml: it opens after two failures in four calls.
    "resilience4j.circuitbreaker.instances.it-breaker.sliding-window-size=4",
    "resilience4j.circuitbreaker.instances.it-breaker.minimum-number-of-calls=4",
    "resilience4j.circuitbreaker.instances.it-breaker.failure-rate-threshold=50",
    "resilience4j.circuitbreaker.instances.it-breaker.wait-duration-in-open-state=60s",
})
@Import({TestcontainersConfiguration.class, TestRoutes.class})
public class ApiIT {
{%- if values.withAuth %}

    private static final RSAKey SIGNING_KEY = signingKey();
    private static final HttpServer JWKS = jwksServer();
{%- endif %}

    @DynamicPropertySource
    static void wiring(DynamicPropertyRegistry registry) {
        registry.add("UPSTREAM_URL", StubUpstream::url);
{%- if values.withAuth %}
        registry.add("adhar.security.jwt.jwk-set-uri",
                () -> "http://127.0.0.1:" + JWKS.getAddress().getPort() + "/certs");
{%- endif %}
    }

    @LocalServerPort
    int port;

    @Test
    void api() {
        Results results = Karate.run("classpath:karate")
                .systemProperty("baseUrl", "http://localhost:" + port)
{%- if values.withAuth %}
                .systemProperty("token", token("api-it"))
{%- endif %}
                .outputCucumberJson(false)
                .parallel(1);
        assertThat(results.getFailCount()).as(results.getErrorMessages()).isZero();
        assertThat(results.getScenariosPassed()).as("scenarios run").isPositive();
    }
{%- if values.withAuth %}

    /** A token as Keycloak would issue it: RS256, realm roles in {@code realm_access.roles}. */
    public static String token(String subject, String... realmRoles) {
        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(subject)
                    .issuer("http://keycloak.adhar-system.svc.cluster.local:8080/realms/adhar")
                    .claim("realm_access", Map.of("roles", List.of(realmRoles)))
                    .claim("scope", "openid profile")
                    .issueTime(new Date())
                    .expirationTime(new Date(System.currentTimeMillis() + 600_000))
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256)
                    .keyID(SIGNING_KEY.getKeyID()).type(JOSEObjectType.JWT).build(), claims);
            jwt.sign(new RSASSASigner(SIGNING_KEY));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    private static RSAKey signingKey() {
        try {
            return new RSAKeyGenerator(2048).keyID("api-it").generate();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    private static HttpServer jwksServer() {
        try {
            byte[] body = new JWKSet(SIGNING_KEY.toPublicJWK()).toString().getBytes(StandardCharsets.UTF_8);
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/certs", exchange -> {
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(200, body.length);
                exchange.getResponseBody().write(body);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
{%- endif %}
}
