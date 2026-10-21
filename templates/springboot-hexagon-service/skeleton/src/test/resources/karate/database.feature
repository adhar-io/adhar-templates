{%- if values.withDatabase %}
Feature: Greetings are stored in PostgreSQL

  With a database the JDBC adapter replaces the in-memory one. These scenarios
  write through the API and read the row back from PostgreSQL itself (the
  Testcontainers instance ApiIT started), so they fail if the service quietly
  kept greetings in memory.

  Background:
    * url baseUrl
    * def query =
      """
      function(sql, id) {
        var DriverManager = Java.type('java.sql.DriverManager');
        var conn = DriverManager.getConnection(karate.get('jdbcUrl'), karate.get('jdbcUser'), karate.get('jdbcPassword'));
        try {
          var st = conn.prepareStatement(sql);
          st.setLong(1, id);
          var rs = st.executeQuery();
          return rs.next() ? rs.getString(1) : null;
        } finally {
          conn.close();
        }
      }
      """

  Scenario: a greeting created through the API is a row in the greeting table
    * def name = 'Grace-' + java.util.UUID.randomUUID()
    Given path 'greet'
    And param name = name
    When method post
    Then status 200
    And match response.message == 'Hello, ' + name + '!'
    * def id = response.id
    * match query('SELECT message FROM greeting WHERE id = ?', id) == 'Hello, ' + name + '!'

    Given path 'greetings'
    When method get
    Then status 200
    And match response contains { id: '#(id)', message: '#("Hello, " + name + "!")' }
{%- else %}
@ignore
Feature: Greetings are stored in PostgreSQL

  This service was scaffolded without a database, so greetings live in memory
  and there is nothing to test here yet. Scaffolding with the database adds a
  scenario that reads what the API wrote back from a Testcontainers PostgreSQL.
{%- endif %}
