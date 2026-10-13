{%- if values.withCache %}
package io.adhar.service.cache;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/cache")
public class CacheController {

    private final LookupService lookups;

    public CacheController(LookupService lookups) {
        this.lookups = lookups;
    }

    @GetMapping("/{key}")
    public LookupService.Lookup get(@PathVariable String key) {
        return lookups.find(key);
    }

    @DeleteMapping("/{key}")
    public void evict(@PathVariable String key) {
        lookups.evict(key);
    }
}
{%- endif %}
