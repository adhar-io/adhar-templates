Feature: Resilience — timeouts, retries, circuit breakers{% if values.withRateLimit %} and rate limits{% endif %}

  What the gateway does when the upstream misbehaves. The tests run with a 1 s
  upstream timeout (ApiIT); the stub upstream's paths are in StubUpstream.

  Background:
    * url baseUrl + '${{ values.routePath }}'

  Scenario: the upstream's own 500 reaches the caller untouched
    Given path 'error'
    When method get
    Then status 500
    And match response == { upstream: 'its own error' }

  Scenario: an upstream slower than the timeout is a 504 problem
    Given path 'slow'
    When method get
    Then status 504
    And match karate.response.header('Content-Type') contains 'application/problem+json'
    And match response contains { status: 504, route: 'upstream' }
    And match response.requestId == karate.response.header('X-Request-ID')

  Scenario: an unavailable upstream answers through the fallback, with Retry-After
    Given path 'unavailable'
    When method get
    Then status 503
    And match response contains { status: 503, route: 'upstream' }
    And match karate.response.header('Retry-After') == '5'

  Scenario: a GET that meets a briefly unavailable upstream is retried and succeeds
    Given path 'flaky', java.util.UUID.randomUUID() + ''
    When method get
    Then status 200
    And match response == { attempt: 3 }

  Scenario: a POST is never retried — it may not be safe to repeat
    Given path 'flaky', java.util.UUID.randomUUID() + ''
    And request {}
    When method post
    Then status 503

  Scenario: a failing upstream opens the circuit, and the gateway stops calling it
    # it-breaker (TestRoutes) is tuned through resilience4j.circuitbreaker.instances.it-breaker:
    # four calls, half failing, opens it.
    * url baseUrl
{%- if values.withAuth %}
    * def call = function(){ return karate.http(baseUrl + '/it-breaker/unavailable').header('Authorization', authorization).get().status }
{%- else %}
    * def call = function(){ return karate.http(baseUrl + '/it-breaker/unavailable').get().status }
{%- endif %}
    * def failures = karate.repeat(4, call)
    * match failures == [503, 503, 503, 503]
    Given path 'it-breaker', 'unavailable'
    When method get
    Then status 503
    And match response.detail contains 'paused'
    And match karate.response.header('Retry-After') == '5'
{%- if values.withRateLimit %}

  Scenario: every response on the route reports the caller's remaining allowance
    Given path 'echo', 'hello'
    When method get
    Then status 200
    And match karate.response.header('X-RateLimit-Remaining') == '#regex [0-9]+'
    And match karate.response.header('X-RateLimit-Burst-Capacity') == '#regex [0-9]+'

  Scenario: a caller over its limit gets 429, without touching anyone else's
    # it-limited (TestRoutes) has a bucket of three. A fresh caller identity, so
    # this bucket is this scenario's alone.
{%- if values.withAuth %}
    * def caller = 'Bearer ' + Java.type('io.adhar.service.ApiIT').token('limited-' + java.util.UUID.randomUUID())
    * def call = function(){ return karate.http(baseUrl + '/it-limited/echo/x').header('Authorization', caller).get().status }
{%- else %}
    * def ip = '10.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) + '.7'
    * def call = function(){ return karate.http(baseUrl + '/it-limited/echo/x').header('X-Forwarded-For', '203.0.113.9, ' + ip).get().status }
{%- endif %}
    * def statuses = karate.repeat(6, call)
    * match statuses[0] == 200
    * match statuses contains 429
{%- endif %}
