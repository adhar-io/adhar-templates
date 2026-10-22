Feature: The gateway's own actuator endpoints

  Routes and circuit breakers are visible at /actuator/gateway and
  /actuator/circuitbreakers{% if values.withAuth %} to callers with the gateway-admin realm role{% else %}, closed while authentication is off{% endif %}.

  Background:
    * url baseUrl
{%- if values.withAuth %}

  Scenario: an ordinary caller cannot read the routes
    Given path 'actuator', 'gateway', 'routes'
    When method get
    Then status 403

  Scenario: a gateway-admin reads the routes and breakers
    * def token = Java.type('io.adhar.service.ApiIT').token('ops', 'gateway-admin')
    * configure headers = { Authorization: '#("Bearer " + token)' }
    Given path 'actuator', 'gateway', 'routes'
    When method get
    Then status 200
    And match response[*].route_id contains 'upstream'

    Given path 'actuator', 'circuitbreakers'
    When method get
    Then status 200
    And match response.circuitBreakers == '#object'
{%- else %}

  Scenario: the routes are not readable without authentication
    Given path 'actuator', 'gateway', 'routes'
    When method get
    Then status 401
{%- endif %}
