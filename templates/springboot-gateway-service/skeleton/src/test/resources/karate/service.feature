Feature: Gateway landing page and errors

  The gateway's own answers: its landing page, and RFC 9457 problem responses
  for anything it cannot route.

  Background:
    * url baseUrl

  Scenario: the landing page names the gateway, without a token
    * configure headers = null
    Given path '/'
    When method get
    Then status 200
    And match response == { service: '${{ values.name }}', status: 'ok' }
    And match karate.response.header('X-Content-Type-Options') == 'nosniff'

  Scenario: a path no route matches is a 404 problem with the request's ID
    Given path 'no-such-endpoint'
    When method get
    Then status 404
    And match karate.response.header('Content-Type') contains 'application/problem+json'
    And match response contains { status: 404, title: 'Not Found', instance: '/no-such-endpoint' }
    And match response.requestId == karate.response.header('X-Request-ID')

  Scenario: the landing page does not accept a POST
    Given path '/'
    And request {}
    When method post
    Then status 405
    And match response contains { status: 405, title: 'Method Not Allowed' }
{%- if values.withAuth %}

  Scenario: a routed path requires a bearer token
    * configure headers = null
    Given url baseUrl + '${{ values.routePath }}/echo/hello'
    When method get
    Then status 401
    And match karate.response.header('WWW-Authenticate') contains 'Bearer'
    And match karate.response.header('X-Request-ID') == '#string'

  Scenario: a token the gateway cannot verify is rejected
    * configure headers = { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl' }
    Given url baseUrl + '${{ values.routePath }}/echo/hello'
    When method get
    Then status 401
{%- endif %}
