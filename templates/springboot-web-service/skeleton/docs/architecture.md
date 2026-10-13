# Architecture

## Request path

```
client → Cilium Gateway (TLS) → HTTPRoute ${{ values.hostname }} → Service ${{ values.name }} → pod :${{ values.port }}
```

`deploy/httproute.yaml` attaches to the platform's shared Gateway. The hostname
is the one thing in that file worth reading carefully — it is what makes the
service reachable, and it must stay under the platform's base domain for the
wildcard certificate to cover it.

The process serves HTTP directly on `${{ values.port }}`. There is no sidecar
proxy in front of it inside the pod; TLS terminates at the platform Gateway.

## Authentication

{% if values.withAuth -%}
Requests need a bearer JWT issued by the platform's Keycloak realm `adhar`.
Adhar Kit's security module validates the signature against the realm's JWKS
(`adhar.security.jwt.jwk-set-uri`); a missing or invalid token is a `401`.
`/actuator/health/**` and `/actuator/info` stay open because Kubernetes probes
cannot authenticate.

To get a token, request one from the `adhar` realm through an OpenID Connect
client your team registers in Keycloak, then send it as `Authorization: Bearer`.
{%- else -%}
Authentication is off — every endpoint is public
(`adhar.security.authorization.permit-all=/**`). To require platform JWTs, remove
that line and set `adhar.security.jwt.jwk-set-uri` to the Keycloak realm's JWKS:
`http://keycloak.keycloak.svc.cluster.local:8080/keycloak/realms/adhar/protocol/openid-connect/certs`.
{%- endif %}

## Deployment shape

`deploy/rollout.yaml` is an Argo **Rollout**, not a Deployment. The difference
matters when something is wrong: a Rollout can pause with old and new pods both
serving, so a bad version is caught by real traffic on a small share of requests
rather than by a full replacement.

- Replicas: `${{ values.replicas }}`
- Strategy: canary, with traffic shifted in steps
- Probes: readiness gates the Service endpoints; liveness restarts a wedged process

!!! warning "Probe timeouts"
    Never set a probe `timeoutSeconds` to `1`. A loaded node needs more than a
    second to answer, and the kubelet will kill a healthy pod — this has
    happened on this platform and cost a database 29 restarts before anyone
    looked at the probe rather than the process.

## Supply chain

The platform's `app-ci` pipeline runs on every push to `main` (a Gitea webhook;
nothing to define in this repository). The chain is:

1. **Build** — Cloud Native Buildpacks produce the image; there is no Dockerfile
   to keep current. Beside it, in parallel: the unit tests, a secret scan
   (gitleaks) and a dependency + manifest scan (trivy) of the source.
2. **Scan** — Trivy scans the built image and fails the run on the severities
   the platform enforces; syft writes its SBOM.
3. **Sign** — cosign signs the digest only once every gate above passed, then
   attests the SBOM to it.
4. **Verify** — the pipeline verifies its own signature and attestation, and a
   Kyverno policy checks the signature again at admission. An image the
   platform did not build and sign does not start.
5. **Deploy** — the verified image tag is written back to `deploy/` and Argo CD
   rolls the canary.

Because verification is at admission, the guarantee holds for anything that
tries to run in the cluster, including an image someone applies by hand.

{%- if values.withDatabase %}

### Database

`deploy/database.yaml` declares a CloudNativePG `Cluster`. CloudNativePG — not
this repository — owns the credential: it generates the password, publishes it as
a Secret, and rotates it. The application reads `SPRING_DATASOURCE_*` from the
environment and never sees a literal password.

Two consequences worth knowing:

- **Do not commit a connection string.** If you find yourself wanting to, the
  environment variable is missing from `deploy/rollout.yaml`, not from the
  Secret.
- **Backups are the platform's, not yours.** The cluster is covered by the
  platform's backup schedule; the scorecard's backup-coverage signal reads that,
  which is why a stateful service with no schedule scores lower.
{%- endif %}
{%- if values.withCache %}

### Cache

`deploy/cache.yaml` is a `Database` claim (`engine: redis`) on the Adhar control
plane, which composes a Valkey instance and a `${{ values.name }}-cache-app`
Secret. Its `uri` reaches Spring as `SPRING_DATA_REDIS_URL`, and
**adhar-kit-cache** makes Valkey the store behind every `@Cacheable` — so all
replicas share one cache, and a canary pod sees the same entries as the stable
ones.

- Entries expire after `${{ values.cacheTtl }}` (`adhar.cache.time-to-live`) and
  are prefixed `${{ values.name }}::` (`adhar.cache.redis.key-prefix`).
- Values are stored as JSON with their type, so a cache hit returns the class
  that was cached — records and `java.time` included — and entries are readable
  with `valkey-cli`.
- `@MultiLevelCache` (Adhar Kit) puts an in-process L1 in front, with Valkey as
  the shared L2.
- A cache is not a database: anything that must survive a Valkey restart
  belongs somewhere else.
{%- endif %}
{%- if values.withKafka %}

### Events

`deploy/kafka.yaml` is a `Messaging` claim that composes a Strimzi Kafka
(KRaft) named `${{ values.name }}-events` and the topic
`${{ values.kafkaTopic }}` (${{ values.kafkaPartitions }} partitions). The
application reaches it on the bootstrap Service through
`SPRING_KAFKA_BOOTSTRAP_SERVERS`.

- **Topics are declared in `deploy/kafka.yaml`**, not created by the client —
  add a topic there and commit.
- The consumer group is the service name, so replicas split partitions; with
  ${{ values.kafkaPartitions }} partitions, more than ${{ values.kafkaPartitions }}
  replicas leaves consumers idle.
- Producer and consumer are traced through the same OpenTelemetry pipeline as
  HTTP requests.
{%- endif %}

## Observability

The service is scraped and its logs collected without any per-service
configuration: the platform's Prometheus selects every ServiceMonitor, Loki
collects container output, and Grafana's dashboards are variable-driven. Emitting
metrics on `/metrics` and logging to stdout is all that is required of the
application.

The Service Catalog's **Metrics** tab queries this workload by name, so keep
`catalog-info.yaml`'s name matching the workload name — that join is what makes
the tab show your service rather than nothing.
