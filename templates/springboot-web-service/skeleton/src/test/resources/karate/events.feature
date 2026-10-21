{%- if values.withKafka %}
Feature: Event stream

  POST /events produces to the Kafka topic; the service's own @KafkaListener
  consumes it and GET /events lists what it received. A round trip through a real
  broker (a Testcontainers instance in these tests).

  Background:
    * url baseUrl
    * configure retry = { count: 30, interval: 1000 }

  Scenario: a published event comes back through Kafka
    * def payload = 'it-' + java.util.UUID.randomUUID()
    Given path 'events'
    And header Content-Type = 'text/plain'
    And request payload
    When method post
    Then status 202
    And match response == { topic: '${{ values.kafkaTopic }}', status: 'sent' }

    Given path 'events'
    And retry until responseStatus == 200 && response.indexOf(payload) >= 0
    When method get
    Then status 200
    And match response == '#[] #string'
    And match response contains payload

  Scenario: publishing without a body is rejected
    Given path 'events'
    And header Content-Type = 'text/plain'
    When method post
    Then status 400
{%- else %}
@ignore
Feature: Event stream

  This service was scaffolded without the Kafka event stream, so there is
  nothing to test here yet. Scaffolding with it adds the event scenarios
  (POST/GET /events through a Testcontainers Kafka broker).
{%- endif %}
