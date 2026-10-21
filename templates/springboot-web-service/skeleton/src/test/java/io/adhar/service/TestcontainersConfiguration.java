package io.adhar.service;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
{%- if values.withCache %}
import org.testcontainers.containers.GenericContainer;
{%- endif %}
{%- if values.withKafka %}
import org.testcontainers.kafka.KafkaContainer;
{%- endif %}
{%- if values.withDatabase %}
import org.testcontainers.postgresql.PostgreSQLContainer;
{%- endif %}

/**
 * The backing services the integration tests run against: the same engines the
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

    /** PostgreSQL, the major version compose.yaml runs locally. */
    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer("postgres:17-alpine");
    }
{%- endif %}
{%- if values.withCache %}

    /** Valkey speaks the Redis protocol, so Spring's Redis connection is the one wired. */
    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> valkey() {
        return new GenericContainer<>("valkey/valkey:8-alpine").withExposedPorts(6379);
    }
{%- endif %}
{%- if values.withKafka %}

    /** A single-node KRaft broker at the Kafka version deploy/base/kafka.yaml provisions. */
    @Bean
    @ServiceConnection
    KafkaContainer kafka() {
        return new KafkaContainer("apache/kafka-native:4.3.1");
    }
{%- endif %}
}
