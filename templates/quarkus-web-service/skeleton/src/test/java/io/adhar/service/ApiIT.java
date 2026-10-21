package io.adhar.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.URL;

import org.junit.jupiter.api.Test;

import com.intuit.karate.Results;
import com.intuit.karate.junit5.Karate;

import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusIntegrationTest;

/**
 * API integration tests: the Karate features in {@code src/test/resources/karate}
 * run against the packaged application, which {@code @QuarkusIntegrationTest}
 * launches from {@code target/} on a free port.
{%- if values.withDatabase %} Quarkus Dev Services starts the
 * PostgreSQL it needs (a Testcontainers container) and hands the launched
 * application its connection settings.
{%- endif %}
 *
 * <p>Run with {@code mvn verify} — failsafe picks up {@code *IT} classes, so
 * {@code mvn test} stays a fast unit-test run.
{%- if values.withDatabase %} Needs a Docker API: a local Docker or
 * Podman socket, or in CI a kubedock sidecar
 * ({@code DOCKER_HOST=tcp://127.0.0.1:2475}, {@code TESTCONTAINERS_RYUK_DISABLED=true}).
 * kubedock runs each container as a Kubernetes pod, so containers must not rely
 * on host bind mounts, privileged mode, Docker-in-Docker or container networks
 * and aliases: the image is a public one with an explicit tag
 * ({@code quarkus.datasource.devservices.image-name}), reached through the host
 * and mapped port Testcontainers reports.
{%- else %} It starts no containers.
{%- endif %}
 */
@QuarkusIntegrationTest
class ApiIT {

    @TestHTTPResource("/")
    URL url;

    @Test
    void api() {
        String baseUrl = url.toString().replaceAll("/$", "");
        Results results = Karate.run("classpath:karate")
                .systemProperty("baseUrl", baseUrl)
                .outputCucumberJson(false)
                .parallel(1);
        assertEquals(0, results.getFailCount(), results.getErrorMessages());
        assertTrue(results.getScenariosPassed() > 0, "no scenarios ran");
    }
}
