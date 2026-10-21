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

  Scenario: the landing page does not accept a POST
    Given path '/'
    And request {}
    When method post
    Then status 405
