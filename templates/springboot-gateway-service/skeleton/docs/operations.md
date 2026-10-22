# Operations

A runbook for `${{ values.name }}`. A gateway's failures are usually someone
else's: start by finding out whether the gateway is failing or reporting that an
upstream is.

## Is it up?

| Question | Where to look |
| --- | --- |
| Is it serving? | `https://${{ values.hostname }}/` answers `{"status":"ok"}` |
| Is the rollout healthy? | Service Catalog → `${{ values.name }}` → **Deployment** |
| Which route is failing? | `spring_cloud_gateway_requests_seconds_count` by `routeId` and `outcome` |
| Is a breaker open? | `resilience4j_circuitbreaker_state{state="open"}`, or `/actuator/circuitbreakers`{% if values.withAuth %} with a `gateway-admin` token{% endif %} |
| Why did it change? | The repo's commit history — every route change is a commit |

## Reading an error

Every response carries `X-Request-ID`; search the logs and Tempo for it. The
gateway's own errors are problem documents that say which kind they are:

| Status | `detail` / cause | It means | Look at |
| --- | --- | --- | --- |
| `401` | missing or invalid token | the caller | the caller's token |
| `403` | valid token, missing role | the caller | `adhar.security.authorization.*` |
{%- if values.withRateLimit %}
| `429` | over the rate limit | the caller is too fast | `gateway.rate-limit.*`, or the caller |
{%- endif %}
| `503`, "at capacity" | the replica is at `gateway.max-in-flight` | **the gateway** | replicas — see Scaling |
| `503`, "in progress to this upstream" | the route is at `gateway.max-concurrent-per-route` | usually a slow upstream | the upstream's latency first |
| `503`, "paused while it recovers" | the route's circuit breaker is open | **the upstream** | the upstream named in `route` |
| `504` | the upstream did not answer in time | **the upstream** | the upstream's latency |
| `502` | the upstream could not be reached | **the upstream**, or the route's `uri` | the upstream's pods and Service |
| `500` with the upstream's own body | the upstream's answer, passed through | **the upstream** | the upstream |

## A circuit breaker is open

The gateway has stopped calling an upstream because most recent calls failed.
That protects the upstream while it recovers and gives callers a fast `503`
instead of a slow failure.

1. Fix the **upstream**. The breaker tries again after 10 seconds on its own and
   closes once trial calls succeed.
2. If it keeps flapping, the upstream is partly failing — look at its error rate
   and latency rather than tuning the breaker.
3. Tune a route's breaker only for a reason you can name, under
   `resilience4j.circuitbreaker.instances.<route>` in `application.yaml`.

## Scaling

| Signal | Meaning | Action |
| --- | --- | --- |
| `gateway_requests_shed_total` rising | replicas at `gateway.max-in-flight` | raise the autoscaler's `maxReplicas` (form value `maxReplicas`, `deploy/base/hpa.yaml`) |
| CPU at the request, HPA at max | not enough replicas | raise `maxReplicas`; the gateway scales out, not up |
| `reactor_netty_connection_provider_pending_connections` > 0 | an upstream's pool is full | the upstream is slow (look first), or raise `gateway.max-concurrent-per-route` |

Never lower `gateway.max-in-flight` to make an alert go away: shedding is what
keeps the requests that are admitted fast.

## Changing a route or a limit

Edit `src/main/resources/application.yaml` and commit. The change is built,
signed and rolled out as a canary, so a bad route reaches a quarter of traffic
before it reaches all of it — watch the **Metrics** tab during the rollout.
Revert the commit to roll back.

- **No secrets in git.** A credential belongs in a Secret referenced by name in
  `deploy/base/rollout.yaml`.
- **`kubectl edit` does not stick.** Argo CD reverts it on the next sync.

## Pods will not start

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `ImagePullBackOff` | the image is not signed, or the node cannot reach the registry | check the build succeeded and the signature verified |
| `CrashLoopBackOff` | the process exits on start | read the logs; usually a mistyped route or property in `application.yaml` |
{%- if values.withRateLimit %}
| `CreateContainerConfigError` | the Valkey Secret does not exist yet | on a first deploy, wait — it appears once `${{ values.name }}-cache` is provisioned |
{%- endif %}
| `Running` but not `Ready` | readiness probe failing | the pod gets no traffic; check the probe and the logs |
| `OOMKilled` | memory limit below need | raise the limit in `deploy/base/rollout.yaml` |
