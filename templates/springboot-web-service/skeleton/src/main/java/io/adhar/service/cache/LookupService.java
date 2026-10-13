{%- if values.withCache %}
package io.adhar.service.cache;

import java.time.Instant;

import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

/**
 * A deliberately slow lookup fronted by the Valkey cache. The first call for a
 * key pays the cost; repeat calls (from any replica) return the stored result
 * with its original {@code computedAt} until the TTL expires or it is evicted.
 *
 * <p>Plain Spring caching annotations: Adhar Kit supplies the store (Valkey, typed
 * JSON, {@code adhar.cache.*} TTL). For a local L1 in front of Valkey, see the kit's
 * {@code @MultiLevelCache}.
 */
@Service
public class LookupService {

    public record Lookup(String key, String value, Instant computedAt) {}

    @Cacheable("lookups")
    public Lookup find(String key) {
        try {
            Thread.sleep(500); // stands in for a database or downstream call
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return new Lookup(key, key.toUpperCase(), Instant.now());
    }

    @CacheEvict("lookups")
    public void evict(String key) {
    }
}
{%- endif %}
