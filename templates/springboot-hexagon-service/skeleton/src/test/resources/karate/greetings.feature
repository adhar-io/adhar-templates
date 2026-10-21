Feature: Greetings

  POST /greet runs the GreetUseCase through the web adapter and stores the
  greeting through the persistence port; GET /greetings lists what was stored.

  Background:
    * url baseUrl
    * def greeting = { id: '#number', message: '#string' }

  Scenario: a named greeting is created and then listed
    * def name = 'Ada-' + java.util.UUID.randomUUID()
    Given path 'greet'
    And param name = name
    When method post
    Then status 200
    And match response == { id: '#number', message: '#("Hello, " + name + "!")' }
    * def created = response

    Given path 'greetings'
    When method get
    Then status 200
    And match each response == greeting
    And match response contains created

  Scenario Outline: a greeting without a usable name greets the World
    Given path 'greet'
    And params <params>
    When method post
    Then status 200
    And match response == { id: '#number', message: 'Hello, World!' }

    Examples:
      | params          |
      | {}              |
      | { name: '   ' } |

  Scenario: greetings get unique, increasing ids
    Given path 'greet'
    When method post
    Then status 200
    * def first = response.id

    Given path 'greet'
    When method post
    Then status 200
    And assert response.id > first

  Scenario: greet only accepts POST
    Given path 'greet'
    When method get
    Then status 405
    And match response contains { status: 405, title: 'Method Not Allowed' }
