Feature: Health

  The SmallRye Health endpoints and the /healthz the Rollout probes.

  Background:
    * url baseUrl

  Scenario Outline: <endpoint> reports UP
    Given path <endpoint>
    When method get
    Then status 200
    And match response == { status: 'UP', checks: '#[]' }
    # No check may be DOWN (with no backing services the list is empty).
    * def notUp = karate.filter(response.checks, function(c){ return c.status !== 'UP' })
    And match notUp == []

    Examples:
      | endpoint                |
      | 'q', 'health'           |
      | 'q', 'health', 'live'   |
      | 'q', 'health', 'ready'  |
{%- if values.withDatabase %}

  Scenario: readiness includes the database connection
    Given path 'q', 'health', 'ready'
    When method get
    Then status 200
    And match response.checks contains { name: 'Database connections health check', status: 'UP', data: '#object' }
{%- endif %}

  Scenario: /healthz answers ok
    Given path 'healthz'
    When method get
    Then status 200
    And match responseHeaders['Content-Type'][0] contains 'text/plain'
    And match response == 'ok'
