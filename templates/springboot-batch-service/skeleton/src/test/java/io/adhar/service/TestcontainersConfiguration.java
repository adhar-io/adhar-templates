package io.adhar.service;

import org.springframework.boot.test.context.TestConfiguration;
{%- if values.withDatabase %}
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
{%- endif %}

/**
 * The backing services the tests run against, started by Testcontainers. Spring starts each
 * container before the application context and stops it afterwards, and
 * {@code @ServiceConnection} points Spring's own connection settings at it, so the job under
 * test runs exactly as in production - only the addresses differ.
 *
 * <p>CI runs these containers through kubedock, which starts each one as a Kubernetes pod;
 * keep additions to public images with explicit tags.</p>
 */
@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {
{%- if values.withDatabase %}

    /** PostgreSQL: adhar-kit-batch migrates the JobRepository schema into it at startup. */
    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer("postgres:17-alpine");
    }
{%- else %}
    // No database option: the JobRepository is the embedded H2 of application.properties.
{%- endif %}
}
