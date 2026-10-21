package io.adhar.service;

import static org.assertj.core.api.Assertions.assertThat;
{%- if values.withAuth %}

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Date;
{%- endif %}

import org.junit.jupiter.api.Test;
{%- if values.withDatabase %}
import org.springframework.beans.factory.annotation.Autowired;
{%- endif %}
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
{%- if values.withAuth %}
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

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
{%- endif %}
{%- if values.withDatabase %}
import org.testcontainers.postgresql.PostgreSQLContainer;
{%- endif %}

import com.intuit.karate.Results;
import com.intuit.karate.junit5.Karate;

/**
 * API integration tests: the Karate features in {@code src/test/resources/karate}
 * run against the real application, started on a random port with every backing
 * service it was scaffolded with running in a container
 * ({@link TestcontainersConfiguration}).
 *
 * <p>Run with {@code mvn verify} — failsafe picks up {@code *IT} classes, so
 * {@code mvn test} stays a fast unit-test run. Needs a Docker API: a local Docker
 * or Podman socket, or in CI a kubedock sidecar
 * ({@code DOCKER_HOST=tcp://127.0.0.1:2475}, {@code TESTCONTAINERS_RYUK_DISABLED=true}).
 * kubedock runs each container as a Kubernetes pod, so containers here must not
 * rely on host bind mounts, privileged mode, Docker-in-Docker or container
 * networks and aliases: every container is a public image with an explicit tag,
 * reached through the host and mapped port Testcontainers reports.
{%- if values.withAuth %}
 *
 * <p>The service requires a Keycloak JWT. Rather than start Keycloak, the test
 * plays its part: it signs tokens with its own RSA key and serves the public half
 * as a JWKS that {@code adhar.security.jwt.jwk-set-uri} points at, so tokens go
 * through the application's real validation path.
{%- endif %}
 */
{%- if values.withDatabase %}
// application.properties reads the connection from SPRING_DATASOURCE_*, which the
// Rollout sets from the CloudNativePG secret, with no default — and adhar-kit
// refuses to start while they are unresolved. @ServiceConnection supplies the real
// connection to the Testcontainers PostgreSQL; these values only satisfy the
// placeholders and are never connected to.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "SPRING_DATASOURCE_URL=jdbc:postgresql://replaced-by-service-connection/app",
        "SPRING_DATASOURCE_USERNAME=unused",
        "SPRING_DATASOURCE_PASSWORD=unused" })
{%- else %}
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
{%- endif %}
@Import(TestcontainersConfiguration.class)
class ApiIT {
{%- if values.withAuth %}

    private static final RSAKey SIGNING_KEY = signingKey();
    private static final HttpServer JWKS = jwksServer();

    @DynamicPropertySource
    static void jwt(DynamicPropertyRegistry registry) {
        registry.add("adhar.security.jwt.jwk-set-uri",
                () -> "http://127.0.0.1:" + JWKS.getAddress().getPort() + "/certs");
    }
{%- endif %}

    @LocalServerPort
    int port;
{%- if values.withDatabase %}

    @Autowired
    PostgreSQLContainer postgres;
{%- endif %}

    @Test
    void api() {
        Results results = Karate.run("classpath:karate")
                .systemProperty("baseUrl", "http://localhost:" + port)
{%- if values.withAuth %}
                .systemProperty("token", token())
{%- endif %}
{%- if values.withDatabase %}
                // database.feature reads back, over JDBC, the rows the API wrote.
                .systemProperty("jdbcUrl", postgres.getJdbcUrl())
                .systemProperty("jdbcUser", postgres.getUsername())
                .systemProperty("jdbcPassword", postgres.getPassword())
{%- endif %}
                .outputCucumberJson(false)
                .parallel(1);
        assertThat(results.getFailCount()).as(results.getErrorMessages()).isZero();
        assertThat(results.getScenariosPassed()).as("scenarios run").isPositive();
    }
{%- if values.withAuth %}

    /** A token as Keycloak would issue it: RS256, signed by a key the JWKS publishes. */
    private static String token() {
        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject("api-it")
                    .issuer("http://keycloak.adhar-system.svc.cluster.local:8080/realms/adhar")
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
