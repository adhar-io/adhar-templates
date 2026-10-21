function fn() {
  // ApiIT starts the application on a random port and hands its address (and,
  // when the service requires authentication, a signed bearer token) to Karate.
  var baseUrl = karate.properties['baseUrl'] || 'http://localhost:8080';
  var token = karate.properties['token'];
  if (token) {
    karate.configure('headers', { Authorization: 'Bearer ' + token });
  }
  karate.configure('connectTimeout', 10000);
  karate.configure('readTimeout', 30000);
  return {
    baseUrl: baseUrl,
    // Set only when the service has a database (see ApiIT).
    jdbcUrl: karate.properties['jdbcUrl'],
    jdbcUser: karate.properties['jdbcUser'],
    jdbcPassword: karate.properties['jdbcPassword']
  };
}
