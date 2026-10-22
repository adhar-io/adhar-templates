Feature: Health and metrics

  The probes the Rollout uses and the endpoint the platform's PodMonitor scrapes.
  These stay open whether or not the service requires authentication.

  Background:
    * url baseUrl
    * configure headers = null

  Scenario: the service reports UP
    Given path 'actuator', 'health'
    When method get
    Then status 200
    And match response.status == 'UP'

  Scenario Outline: the Kubernetes <probe> probe reports UP
    Given path 'actuator', 'health', '<probe>'
    When method get
    Then status 200
    And match response == { status: 'UP' }

    Examples:
      | probe     |
      | liveness  |
      | readiness |

  Scenario: Prometheus metrics are exposed: latency per route, load, breakers, connection pools
    * configure headers = karate.get('authHeaders', null)
    Given url baseUrl + '${{ values.routePath }}/echo/metrics'
    When method get
    Then status 200
    * configure headers = null

    Given url baseUrl
    And path 'actuator', 'prometheus'
    When method get
    Then status 200
    And match responseHeaders['Content-Type'][0] contains 'text/plain'
    And match response contains 'http_server_requests_seconds_bucket'
    And match response contains 'spring_cloud_gateway_requests_seconds_bucket'
    And match response contains 'gateway_requests_inflight'
    And match response contains 'resilience4j_circuitbreaker_state'
    And match response contains 'reactor_netty_connection_provider'
