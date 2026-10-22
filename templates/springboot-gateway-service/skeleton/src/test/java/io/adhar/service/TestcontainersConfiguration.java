package io.adhar.service;

import org.springframework.boot.test.context.TestConfiguration;
{%- if values.withRateLimit %}
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;
{%- endif %}

/**
 * The backing services the integration tests run against: the same engines the
 * platform provisions from deploy/, started by Testcontainers, with
 * {@code @ServiceConnection} pointing Spring's own connection settings at them.
 *
 * <p>CI runs these containers through kubedock, which starts each one as a
 * Kubernetes pod; keep additions to public images with explicit tags, reached
 * through the host and mapped port Testcontainers reports (see {@link ApiIT}).
 */
@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {
{%- if values.withRateLimit %}

    /** Valkey for the rate limiter; it speaks the Redis protocol, so Spring's Redis connection is the one wired. */
    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> valkey() {
        return new GenericContainer<>("valkey/valkey:8-alpine").withExposedPorts(6379);
    }
{%- endif %}
}
