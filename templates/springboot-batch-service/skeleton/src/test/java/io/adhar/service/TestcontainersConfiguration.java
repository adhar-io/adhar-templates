package io.adhar.service;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;

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

    /**
     * PostgreSQL, as deploy/base/database.yaml provisions it: adhar-kit-batch migrates the
     * JobRepository schema into it at startup. The kit refuses an in-memory repository, so
     * there is no database-less variant of these tests.
     */
    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer("postgres:17-alpine");
    }
}
