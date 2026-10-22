Feature: Routing to the upstream

  ${{ values.routePath }}/** goes to the upstream with a request ID and the
  caller's verified identity, and nothing the caller claimed about itself.

  Background:
    * url baseUrl + '${{ values.routePath }}'
    * def upstreamPath = '{% if values.stripPrefix %}/echo/hello{% else %}${{ values.routePath }}/echo/hello{% endif %}'

  Scenario: a request under the prefix reaches the upstream, with a request ID both sides see
    Given path 'echo', 'hello'
    When method get
    Then status 200
    And match response.path == upstreamPath
    And match response.method == 'GET'
    * def requestId = karate.response.header('X-Request-ID')
    And match requestId == '#uuid'
    And match response.requestId == requestId
    And match response.correlationId == requestId

  Scenario: a well-formed request ID from the caller is kept
    Given path 'echo', 'hello'
    And header X-Request-ID = 'it-request-0001'
    When method get
    Then status 200
    And match karate.response.header('X-Request-ID') == 'it-request-0001'
    And match response.requestId == 'it-request-0001'

  Scenario: a malformed request ID is replaced
    Given path 'echo', 'hello'
    And header X-Request-ID = 'short'
    When method get
    Then status 200
    And match karate.response.header('X-Request-ID') == '#uuid'

  Scenario: identity headers the caller sends are never trusted
    Given path 'echo', 'hello'
    And header X-User-ID = 'mallory'
    And header X-User-Roles = 'admin'
    When method get
    Then status 200
{%- if values.withAuth %}
    And match response.userId == 'api-it'
    And match response.roles == ''
    And match response.authorization == true
{%- else %}
    And match response.userId == ''
    And match response.roles == ''
{%- endif %}
{%- if values.withAuth %}

  Scenario: the caller's subject and realm roles reach the upstream
    * def token = Java.type('io.adhar.service.ApiIT').token('alice', 'orders-read', 'orders-write')
    * configure headers = { Authorization: '#("Bearer " + token)' }
    Given path 'echo', 'hello'
    When method get
    Then status 200
    And match response.userId == 'alice'
    And match response.roles == 'orders-read,orders-write'
{%- endif %}

  Scenario: a POST is routed with its method and body
    Given path 'echo', 'orders'
    And request { item: 'book' }
    When method post
    Then status 200
    And match response.method == 'POST'

  Scenario: a browser origin on the allow-list gets a CORS preflight answer
    * configure headers = null
    Given path 'echo', 'hello'
    And header Origin = 'https://app.example.test'
    And header Access-Control-Request-Method = 'GET'
    When method options
    Then status 200
    And match karate.response.header('Access-Control-Allow-Origin') == 'https://app.example.test'

  Scenario: any other origin is refused
    * configure headers = null
    Given path 'echo', 'hello'
    And header Origin = 'https://evil.example'
    And header Access-Control-Request-Method = 'GET'
    When method options
    Then status 403
