# ${{ values.name }}

${{ values.description }}

An **API gateway** (Spring Cloud Gateway on WebFlux) scaffolded from the Adhar
`springboot-gateway-service` golden path. Callers reach the services behind it
through one address, and every call gets the same authentication, limits,
failure handling, request ID and trace — written once here, not in every service.

## What you got

| Thing | Where |
| --- | --- |
| Routes and every tunable | `src/main/resources/application.yaml` |
| Gateway code | `src/main/java/io/adhar/service/` — filters, security, fallbacks |
| Kubernetes manifests | `deploy/` — Rollout, Service, HTTPRoute, autoscaler, disruption budget, alerts{% if values.withRateLimit %}, Valkey claim{% endif %} |
| Local dependencies | `compose.yaml` — an echo upstream{% if values.withRateLimit %} and Valkey{% endif %} |
| Tests | `src/test/` — unit tests, and Karate API tests against the running gateway |
| Build | the platform `app-ci` pipeline, on every push — nothing to define here |
| Catalog entry | `catalog-info.yaml` |

The gateway is at **https://${{ values.hostname }}** once the first rollout
completes. Its first route sends `${{ values.routePath }}/**` to
`${{ values.upstreamUrl }}`.

## Adhar Kit

The gateway builds on `adhar-kit-parent` (Spring Boot, Spring Cloud, the
platform's dependency floors, the JDK 25 rule and the coverage gate) and these
kit modules:

| Module | What it does here |
| --- | --- |
| `adhar-kit-resilience` | Exports every route's circuit breaker as metrics and records its state changes |
| `adhar-kit-tracing` | The OpenTelemetry SDK that traces every request and upstream call |
| `adhar-kit-metrics`, `adhar-kit-health` | Platform metrics and health indicators |
| `adhar-kit-commons` | The header names (`X-Request-ID`, `X-Correlation-ID`, `X-User-ID`) every Adhar service reads |
| `adhar-kit-core`, `adhar-kit-config` | Core utilities and configuration validation |

Not `adhar-kit-starter`, `adhar-kit-security` or `adhar-kit-logging`: in kit
0.1.0 they are built for Spring MVC and cannot start in a reactive application.
The gateway does their jobs reactively — `SecurityConfig` reads the same
`adhar.security.*` properties, and logs are JSON through Spring Boot's
structured logging. See [Architecture](architecture.md#adhar-kit).

## Run it locally

Requires JDK 25, Maven 3.9+ and Docker.

```bash
docker compose up -d
UPSTREAM_URL=http://localhost:3000 mvn -s settings.xml spring-boot:run
curl -i localhost:8080${{ values.routePath }}/hello{% if values.withAuth %} -H "Authorization: Bearer $TOKEN"{% endif %}
```

The echo upstream answers with what it received, so you can see what the gateway
forwards: the rewritten path, `X-Request-ID`{% if values.withAuth %}, `X-User-ID`, `X-User-Roles`{% endif %}.

Tests:

```bash
mvn -s settings.xml test     # unit tests — what CI runs on every push
mvn -s settings.xml verify   # + the API tests against the running gateway (Docker)
```

## Ship a change

```text
git push  →  build + scan + sign  →  Argo CD  →  Argo Rollouts (canary)
```

Every change to a route, a limit or a timeout is a commit, reviewed like code
and rolled out as a canary. There is no admin API that changes routes at
runtime, on purpose: a gateway's configuration is the most consequential
configuration in the system.

See [Operations](operations.md) for what to do when it misbehaves.

## Who owns this

`${{ values.owner }}`. Ownership is declared in `catalog-info.yaml` and is what
the Service Catalog, the scorecards and the on-call routing all read.
