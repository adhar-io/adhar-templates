function fn() {
  // ApiIT launches the packaged application on a free port and hands its
  // address to Karate.
  var baseUrl = karate.properties['baseUrl'] || 'http://localhost:8080';
  karate.configure('connectTimeout', 10000);
  karate.configure('readTimeout', 30000);
  return { baseUrl: baseUrl };
}
