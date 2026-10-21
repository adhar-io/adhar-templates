Feature: Service landing page

  Background:
    * url baseUrl

  Scenario: the landing page names the service
    Given path '/'
    When method get
    Then status 200
    And match response == { service: '${{ values.name }}', status: 'ok' }

  Scenario: an unknown path is not found
    Given path 'no-such-endpoint'
    When method get
    Then status 404
    And match response contains { status: 404, title: 'Not Found', instance: '/no-such-endpoint' }

  Scenario: the landing page does not accept a POST
    Given path '/'
    And request {}
    When method post
    Then status 405
    And match response contains { status: 405, title: 'Method Not Allowed' }
{%- if values.withAuth %}

  Scenario: the landing page stays open without a token
    * configure headers = null
    Given path '/'
    When method get
    Then status 200
    And match response.service == '${{ values.name }}'

  Scenario: any other endpoint requires a bearer token
    * configure headers = null
    Given path 'no-such-endpoint'
    When method get
    Then status 401

  Scenario: a token the service cannot verify is rejected
    * configure headers = { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl' }
    Given path 'no-such-endpoint'
    When method get
    Then status 401
{%- endif %}
