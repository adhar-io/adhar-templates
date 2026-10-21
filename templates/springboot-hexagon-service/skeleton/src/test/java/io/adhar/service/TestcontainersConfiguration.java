package io.adhar.service;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
{%- if values.withDatabase %}
import org.testcontainers.postgresql.PostgreSQLContainer;
{%- endif %}

/**
 * The backing services the integration tests run against: the engine the
 * platform provisions from deploy/, started by Testcontainers. Spring starts each
 * container before the application context and stops it afterwards, and
 * {@code @ServiceConnection} points Spring's own connection settings at it, so the
 * application under test is configured exactly as in production — only the
 * addresses differ.
 *
 * <p>CI runs these containers through kubedock, which starts each one as a
 * Kubernetes pod; keep additions to public images with explicit tags, reached
 * through the host and mapped port Testcontainers reports (see {@link ApiIT}).
 */
@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {
{%- if values.withDatabase %}

    /** PostgreSQL; the schema comes from src/main/resources/schema.sql, as in production. */
    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer("postgres:17-alpine");
    }
{%- endif %}
}
