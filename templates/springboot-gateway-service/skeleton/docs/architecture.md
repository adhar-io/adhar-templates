# Architecture

## Request path

```text
client → platform Gateway (TLS) → HTTPRoute ${{ values.hostname }} → Service ${{ values.name }}
       → gateway pod :${{ values.port }} → ${{ values.upstreamUrl }}
```

TLS terminates at the platform's shared Gateway; this gateway speaks plain
HTTP/1.1 and HTTP/2 (h2c) inside the cluster. It reaches upstreams by Kubernetes
Service name, so a route's `uri: http://orders` is the `orders` Service in the
same namespace — dev, test and prod each route to their own copy.

## Why reactive

Spring Cloud Gateway runs on WebFlux and Reactor Netty: a few event-loop threads
(one per core) serve every connection, and a request waiting on its upstream
holds no thread at all. That is what lets one replica hold tens of thousands of
concurrent connections, and why it is the right shape for a gateway — most of a
gateway's time is spent waiting on someone else.

The rule that comes with it: **nothing on the request path may block.** A
blocking call (JDBC, a synchronous HTTP client, `Thread.sleep`, a `.block()`)
parks an event-loop thread and stalls every connection on it. If a filter needs
I/O, use a reactive client (`WebClient`, reactive Redis) and return a `Mono`.

## The filter chain

In order, for a request to `${{ values.routePath }}/**`:

| # | Step | What it guarantees |
| --- | --- | --- |
| 1 | `RequestIdFilter` | Every request has an `X-Request-ID` the caller, the logs and the upstream all see |
| 2 | `LoadSheddingFilter` | Above `gateway.max-in-flight` (${{ values.maxInFlight }}) concurrent requests, a replica answers `503` + `Retry-After` at once instead of slowing everyone down |
| 3 | Spring Security | CORS, then {% if values.withAuth %}the bearer JWT and path rules{% else %}path rules (authentication is off){% endif %} |
| 4 | `IdentityPropagationFilter` | Client-sent `X-User-ID`/`X-User-Roles` removed; {% if values.withAuth %}set from the verified token{% else %}nothing set while authentication is off{% endif %} |
{%- if values.withRateLimit %}
| 5 | `RequestRateLimiter` | Token bucket per caller in Valkey; over the limit is `429` |
{%- endif %}
| {% if values.withRateLimit %}6{% else %}5{% endif %} | `CircuitBreaker` (+ bulkhead, time limit) | A failing upstream is cut off quickly; one slow upstream cannot take every connection |
| {% if values.withRateLimit %}7{% else %}6{% endif %} | `Retry` | A GET that hit a dead connection or a pod going away is tried again |
| — | HTTP client | Pooled connections to the upstream, `gateway.upstream-timeout` per attempt |

Errors the gateway produces itself are RFC 9457 problems
(`application/problem+json`) with the `requestId`; errors the upstream returns
pass through untouched.

## Authentication

{% if values.withAuth -%}
Requests need a bearer JWT from the platform's Keycloak realm `adhar`,
validated against the realm's signing keys (`adhar.security.jwt.jwk-set-uri`).
The keys are cached, and refetched when Keycloak rotates them. Realm roles
become `ROLE_<role>` authorities.

- **Path rules** — `adhar.security.authorization.authorities` maps a path
  pattern to the roles that may call it; `permit-all` lists open paths.
- **The token is relayed**, unchanged, so an upstream that validates it itself
  still can. The verified identity also reaches the upstream as `X-User-ID`
  (the subject) and `X-User-Roles` (realm roles, comma-separated).
- `/actuator/gateway/**` and `/actuator/circuitbreakers` need the realm role
  `gateway-admin`. Probes and `/actuator/prometheus` stay open.
{%- else -%}
Authentication is off: every route is public. To require platform JWTs:

1. Add `spring-boot-starter-security-oauth2-resource-server` to `pom.xml`.
2. In `SecurityConfig`, configure `http.oauth2ResourceServer(...)` and replace
   `anyExchange().permitAll()` with `anyExchange().authenticated()`.
3. Set `adhar.security.jwt.jwk-set-uri` to the realm's JWKS:
   `http://keycloak.adhar-system.svc.cluster.local:8080/realms/adhar/protocol/openid-connect/certs`.

Scaffolding a new gateway with authentication on shows the finished version.
{%- endif %}

!!! warning "Identity headers are only as good as the network"
    `X-User-ID` means something only if the upstream can be reached **only**
    through the gateway. Give upstreams a NetworkPolicy that admits traffic
    from this gateway's pods, or have them validate the bearer token themselves.

## Resilience

| Mechanism | Setting | Behaviour |
| --- | --- | --- |
| Load shedding | `gateway.max-in-flight` | `503` above the ceiling, per replica; probes exempt |
| Per-route bulkhead | `gateway.max-concurrent-per-route` | `503` when one route has that many calls open; sized with the route's connection pool |
| Circuit breaker | `gateway.circuit-breaker.*`, per route `resilience4j.circuitbreaker.instances.<route>.*` | Opens at 50% failures over the last 100 calls (or 80% slow calls), answers `503` for 10 s, then probes |
| Time limits | `gateway.upstream-timeout` | `504` after ${{ values.timeoutMs }} ms per attempt; the breaker caps the whole call at twice that |
| Retry | the route's `Retry` filter | GET/HEAD only; I/O errors and `502`/`503`; never on timeouts |
{%- if values.withRateLimit %}
| Rate limit | `gateway.rate-limit.*` | ${{ values.rateLimitPerSecond }}/s per caller, burst ${{ values.rateLimitBurst }}; fails open if Valkey is down |
{%- endif %}

What counts as an upstream failure is deliberate: `502`, `503` and `504` from the
upstream, connection errors and timeouts. A `500` is the service's own answer and
passes through untouched; a full bulkhead is this replica at capacity and does
not open the upstream's breaker.

## Performance

- **Connection pool per upstream** (`spring.cloud.gateway.server.webflux.httpclient.pool`):
  fixed size, idle connections closed at 30 s (below typical upstream keep-alive,
  so the gateway never reuses one the upstream just closed), every connection
  recycled after 5 minutes so new upstream pods get traffic.
- **Native transport** — epoll on Linux, fewer syscalls per connection.
- **Generational ZGC** (`JAVA_TOOL_OPTIONS` in the Rollout) — sub-millisecond GC
  pauses, so a collection never shows up as a latency spike on every route.
- **No CPU limit** — CFS throttling would stall every connection on an event
  loop at once. Scale out with replicas; the autoscaler adds them at 70% CPU.

## Adhar Kit

The gateway uses `adhar-kit-parent` and the kit's framework-neutral modules
(core, commons, config, resilience, health, metrics, tracing). Three kit pieces
are deliberately absent, because in kit 0.1.0 they are built for Spring MVC:

| Kit module | Why not here | What the gateway does instead |
| --- | --- | --- |
| `adhar-kit-starter` | Pulls in Spring MVC and Tomcat; with them Spring Boot starts a servlet app and the gateway does not run | Depends on the kit modules one by one |
| `adhar-kit-security` | Servlet `SecurityFilterChain` and filters | `SecurityConfig`, a reactive `SecurityWebFilterChain` reading the same `adhar.security.*` properties |
| `adhar-kit-logging` | Fails at startup without the servlet API | JSON logs through Spring Boot's structured logging (`logging.structured`) |

Two kit behaviours are adjusted:

- **Per-route breaker tuning uses `resilience4j.circuitbreaker.instances.*`**, not
  `adhar.resilience.circuit-breaker.*`. The kit reads its own properties only in
  its own registry, which steps aside when Resilience4j's Spring Boot registry is
  present — as it is here, through Spring Cloud CircuitBreaker.
- **The kit's circuit-breaker health indicator is off**
  (`adhar.resilience.health.enabled`). It reports DOWN while any breaker is open,
  which for a gateway is the gateway doing its job.

## Observability

- **Metrics** — `/actuator/prometheus`, scraped by the platform's PodMonitor:
  `spring_cloud_gateway_requests_seconds` per route and status,
  `resilience4j_circuitbreaker_*` per route, `gateway_requests_inflight`,
  `gateway_requests_shed_total`, `gateway_fallbacks_total{route,reason}`,
  `reactor_netty_connection_provider_*` per upstream.
- **Traces** — every request, and every upstream call inside it, through Adhar
  Kit's OpenTelemetry SDK to the platform collector (`adhar.tracing.*`). The
  trace context is propagated upstream, so a trace starts at the gateway and
  continues through every service behind it.
- **Logs** — one JSON object per line on stdout, with the traceId of the request.
- **Alerts** (`deploy/base/alerts.yaml`) — pods restarting or unavailable, 5xx
  rate, a circuit breaker open, sustained load shedding, an exhausted upstream
  connection pool.

## Deployment shape

`deploy/base/rollout.yaml` is an Argo **Rollout** with canary steps. dev runs
`${{ values.replicas }}` replica(s), test 2 and prod 3, and the autoscaler adds
more under load up to `${{ values.maxReplicas or 6 }}`. A PodDisruptionBudget and
topology spread keep replicas on different nodes. The gateway runs as its own
ServiceAccount with no Kubernetes API token mounted.
