# ${{ values.name }}

${{ values.description }}

An API gateway on **Spring Cloud Gateway** (WebFlux, Reactor Netty) with
**Adhar Kit**, scaffolded by Adhar. It is the one front door for the services
behind it: it authenticates callers, limits them, protects the upstreams from
overload and failure, and gives every request an ID and a trace.

```text
client → platform Gateway (TLS) → ${{ values.name }} → ${{ values.routePath }}/** → ${{ values.upstreamUrl }}
```

It ships through the platform's **secure supply chain** with **progressive
delivery**:

```text
git push → buildpacks (Maven build) → Harbor → trivy scan → cosign sign
        → kyverno verifies the signature → ArgoCD → Argo Rollouts (canary)
```

## What every request goes through

| Step | Where | Configured by |
|---|---|---|
| Request ID (`X-Request-ID`, `X-Correlation-ID`) | `RequestIdFilter` | — |
| Load shedding: `503` above ${{ values.maxInFlight }} in-flight requests per replica | `LoadSheddingFilter` | `gateway.max-in-flight` |
| CORS | `SecurityConfig` | `gateway.cors.allowed-origins` |
{%- if values.withAuth %}
| Keycloak JWT, realm roles as `ROLE_<role>` | `SecurityConfig` | `adhar.security.jwt.jwk-set-uri`, `adhar.security.authorization.*` |
{%- endif %}
| Caller identity to the upstream (`X-User-ID`, `X-User-Roles`); spoofed values removed | `IdentityPropagationFilter` | — |
{%- if values.withRateLimit %}
| Rate limit per caller: ${{ values.rateLimitPerSecond }}/s, burst ${{ values.rateLimitBurst }}, shared through Valkey | route filter `RequestRateLimiter` | `gateway.rate-limit.*` |
{%- endif %}
| Circuit breaker and bulkhead per route; fallback answers | route filter `CircuitBreaker`, `FallbackController` | `gateway.circuit-breaker.*`, `gateway.max-concurrent-per-route` |
| Retry of GET/HEAD on connection failures and 502/503 | route filter `Retry` | the route in `application.yaml` |
| Upstream timeout: `504` after ${{ values.timeoutMs }} ms | HTTP client | `gateway.upstream-timeout` |
| Errors as RFC 9457 problems with the request ID | `ProblemDetailsErrorHandler` | — |

## Endpoints

{% if values.withAuth -%}
Everything under `${{ values.routePath }}` requires a bearer JWT from the
platform's Keycloak realm `adhar` (`Authorization: Bearer <token>`).
{%- else -%}
Every route is public. See `docs/architecture.md` to require a Keycloak JWT.
{%- endif %}

| Path | Purpose |
|---|---|
| `${{ values.routePath }}/**` | Routed to `${{ values.upstreamUrl }}`{% if values.stripPrefix %} without the `${{ values.routePath }}` prefix{% endif %} |
| `/` | Gateway info |
| `/actuator/health/liveness`, `/readiness` | Kubernetes probes |
| `/actuator/prometheus` | Metrics for the platform's Prometheus |
| `/actuator/gateway/routes`, `/actuator/circuitbreakers` | Routes and breaker states{% if values.withAuth %} (realm role `gateway-admin`){% else %} (closed while authentication is off){% endif %} |

## Add a route

Copy the `upstream` route in `src/main/resources/application.yaml`, give it a
new `id`, path and `uri`, and rename its circuit breaker and fallback to match:

```yaml
            - id: orders
              uri: http://orders
              predicates:
                - Path=/api/orders/**
              filters:
                # ... the same filters as `upstream`, with:
                - name: CircuitBreaker
                  args:
                    name: orders
                    fallbackUri: forward:/fallback/orders
```

A bare Service name (`http://orders`) resolves in the gateway's own namespace,
so the same route works in dev, test and prod.

## Layout

```text
.
├── pom.xml              # adhar-kit-parent + Spring Cloud Gateway + Adhar Kit modules
├── settings.xml         # platform Nexus (maven-public)
├── compose.yaml         # local echo upstream{% if values.withRateLimit %} and Valkey{% endif %}
├── project.toml         # buildpack: BP_MAVEN_SETTINGS_PATH, BP_JVM_VERSION
├── src/main/java/io/adhar/service/
│   ├── config/          # GatewayProperties, ResilienceConfig (breakers, bulkheads)
│   ├── security/        # SecurityConfig (JWT, CORS, path rules)
│   ├── ratelimit/       # CallerKeyResolver
│   └── web/             # request ID, load shedding, identity, errors, fallbacks
├── src/main/resources/application.yaml   # routes and every tunable
├── src/test/            # unit tests + Karate API tests (ApiIT)
└── deploy/              # GitOps tree — ArgoCD syncs it
    ├── base/            # Rollout, Service, HTTPRoute, HPA, PDB, alerts{% if values.withRateLimit %}, Valkey claim{% endif %}
    └── envs/            # dev, test, prod overlays
```

## Local development

Requires JDK 25, Maven 3.9+ and Docker.

```sh
docker compose up -d
UPSTREAM_URL=http://localhost:3000 mvn -s settings.xml spring-boot:run
curl -i localhost:8080${{ values.routePath }}/hello{% if values.withAuth %} -H "Authorization: Bearer $TOKEN"{% endif %}
```

Tests: `mvn -s settings.xml test` for the unit tests, `mvn -s settings.xml verify`
for the API tests (needs Docker).

Access the deployed gateway at `https://${{ values.hostname }}:8443`.
