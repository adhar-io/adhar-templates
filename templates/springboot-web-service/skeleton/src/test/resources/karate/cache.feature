{%- if values.withCache %}
Feature: Cached lookups

  GET /cache/{key} is a deliberately slow lookup behind @Cacheable, stored in
  Valkey (a Testcontainers instance in these tests). A cached answer keeps the
  computedAt of the call that produced it; DELETE evicts it.

  Background:
    * url baseUrl
    * def key = 'it-' + java.util.UUID.randomUUID()

  Scenario: a lookup is computed once, served from the cache, and recomputed after eviction
    Given path 'cache', key
    When method get
    Then status 200
    And match response == { key: '#(key)', value: '#(key.toUpperCase())', computedAt: '#string' }
    * def first = response.computedAt

    Given path 'cache', key
    When method get
    Then status 200
    And match response == { key: '#(key)', value: '#(key.toUpperCase())', computedAt: '#(first)' }

    Given path 'cache', key
    When method delete
    Then status 200

    Given path 'cache', key
    When method get
    Then status 200
    And match response.value == key.toUpperCase()
    And match response.computedAt != first
{%- else %}
@ignore
Feature: Cached lookups

  This service was scaffolded without the Valkey cache, so there is nothing to
  test here yet. Scaffolding with it adds the cache scenarios (GET/DELETE
  /cache/{key} against a Testcontainers Valkey).
{%- endif %}
