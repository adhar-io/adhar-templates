# Architecture

## The request path

```
client ─HTTPS→ platform Gateway (adhar-gateway: TLS, the platform certificate)
       → HTTPRoute ${{ values.name }} → Kourier (knative-serving)
       → DomainMapping <host> → Knative Service ${{ values.name }}
       → activator (while scaled to zero, or short of capacity)
       → revision pod: queue-proxy → your process on $PORT (8080)
```

The `Function` composition builds all of it from `deploy/base/function.yaml`:
the Knative Service, the HTTPRoute on the platform Gateway, the DomainMapping and
its ClusterDomainClaim (a host belongs to the first namespace that claims it),
and a NetworkPolicy that admits Knative's components into the environment
namespace. External DNS publishes the host; TLS ends at the Gateway. With
`visibility: cluster` only the in-cluster address exists.

## Scaling

- `minScale: 0` lets the function scale to zero when no request has arrived
  for a while; the next request waits for a cold start. Set `minScale: 1` in the
  overlay of an environment that cannot wait.
- `maxScale` caps the instances. `targetConcurrency` (default 100 in-flight
  requests per instance) is the autoscaler's soft target;
  `containerConcurrency` (default 0, unlimited) the hard cap.
- `timeoutSeconds` bounds each request (at most 600).

## Triggers

HTTP is always served. `trigger` and `eventSource` add one event source:

| `trigger` | `eventSource` | What invokes the function |
| --- | --- | --- |
| `http` | — | HTTPS requests only |
| `cron` | a schedule, e.g. `*/5 * * * *` | a Knative PingSource POSTs a CloudEvent to `/` on schedule |
| `cloudevent` | attributes, e.g. `type=com.acme.order.created,source=shop` | a Knative Trigger on the namespace's Broker (created when absent) |
| `topic` | a topic, e.g. `orders.v1` or `<pubsub>/<topic>` | a Dapr subscription; turns Dapr on and keeps one instance warm |
| `bucket` | a bucket | not implemented yet: the function is served over HTTP only |

For several sources at once, replace them with a `triggers:` list in
`deploy/base/function.yaml`. Events arrive as HTTP POSTs to `/` (or a path you
give), CloudEvents in binary mode — the `ce-type`, `ce-source`, `ce-id` headers.

## What the function is given

`PORT` (from Knative), `FUNCTION_NAME`, `FUNCTION_RUNTIME`, `FUNCTION_TRIGGER`,
`ADHAR_ENVIRONMENT`, and OpenTelemetry's `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`. Add your own under
`spec.parameters.env`; never put a secret there.

## Delivery

Every environment of the project runs this function. app-ci tags the signed
image with the commit SHA, which makes it Kargo freight; each Stage pins the
digest in `deploy/envs/<env>`, renders the overlay to the branch `stage/<env>`,
and Argo CD syncs that branch. After each promotion Kargo verifies the
environment from Prometheus, in a way that suits a function that may be scaled
to zero — silence passes, evidence of a broken release fails:

- the `Function` is not Degraded, and is Healthy within the settle window
  (Argo CD's health check reads its ServiceReady and EdgeReady conditions);
- no revision pod stays not-Ready past the settle window;
- no revision container restarts;
- the share of 5xx answered through Knative's activator stays under the
  threshold.
