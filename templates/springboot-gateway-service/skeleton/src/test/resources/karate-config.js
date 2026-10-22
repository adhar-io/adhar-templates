function fn() {
  // ApiIT starts the gateway on a random port and hands its address (and, when
  // the gateway requires authentication, a signed bearer token) to Karate.
  var baseUrl = karate.properties['baseUrl'] || 'http://localhost:8080';
  var token = karate.properties['token'];
  var authorization = token ? 'Bearer ' + token : '';
  var authHeaders = token ? { Authorization: authorization } : null;
  if (authHeaders) {
    karate.configure('headers', authHeaders);
  }
  karate.configure('connectTimeout', 10000);
  karate.configure('readTimeout', 30000);
  return { baseUrl: baseUrl, authorization: authorization, authHeaders: authHeaders };
}
