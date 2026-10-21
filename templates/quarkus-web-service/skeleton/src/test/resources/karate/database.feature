{%- if values.withDatabase %}
Feature: Database connectivity

  GET /db runs a query on PostgreSQL (the Dev Services container in these
  tests, the CloudNativePG cluster in deploy/ when deployed).

  Background:
    * url baseUrl

  Scenario: the service queries its database
    Given path 'db'
    When method get
    Then status 200
    And match response == { db: 'ok', now: '#string' }
    # SELECT now() really ran: the answer is a timestamp from the database server.
    And match response.now == '#regex \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}.*'
{%- else %}
@ignore
Feature: Database connectivity

  This service was scaffolded without a database, so there is nothing to test
  here yet. Scaffolding with it adds GET /db against a Dev Services PostgreSQL.
{%- endif %}
