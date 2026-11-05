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

## The code

```
src/server.ts        the process: listen on $PORT; on SIGTERM finish what is in flight, then exit
 └─ src/http.ts      GET /healthz answers on its own; every other request — any path,
     │               any method, every event — has its body read (at most 1 MiB, else 413)
     └─ src/handler.ts   invoke(invocation, config) → the JSON answer
```

| File | What it does |
| --- | --- |
| `src/handler.ts` | The function. `invoke` gets an `Invocation` — method, path, headers, the CloudEvent type (`ce-type`) when an event invoked it, the body — and returns the answer; make it `async` when it has something to wait for. Its result type is the `Invocation` schema in `api/openapi.yaml`: change the two together. |
| `src/http.ts` | HTTP on the standard library, no framework. An error the function throws is logged and answered with a 500 that does not carry its message, which can name hosts, queries or credentials. |
| `src/server.ts` | Starts the server on `$PORT` and stops it on SIGTERM, the signal Knative sends before it scales an instance away. |
| `src/config.ts` | `PORT`, `FUNCTION_NAME`, `FUNCTION_RUNTIME` and `FUNCTION_TRIGGER`, read once at startup; a `PORT` that is not a port stops the function, naming it. |
| `src/log.ts` | One JSON object per line — on stdout, errors on stderr — which Loki collects from the container's output. |

`test/unit/` tests each module in-process; `test/integration/` starts the
compiled `dist/server.js` the way the image does, invokes it over HTTP and
stops it with SIGTERM.

The function is strict TypeScript compiled to CommonJS. `npm test` runs ESLint
(typescript-eslint, type-checked rules), `tsc --noEmit` and `npm run build`
before the tests, which are TypeScript too and run through `tsx`. The image
build runs `npm run build` as well (`BP_NODE_RUN_SCRIPTS` in `project.toml`):
`tsc` compiles `src/` to `dist/` with source maps, the devDependencies are
pruned, and the container starts `node --enable-source-maps dist/server.js` —
package.json's `start` script. A type error fails the tests and the image
build alike.

Node.js 24 could run `src/server.ts` itself, but its type stripping checks no
types and takes only the TypeScript that erases to plain JavaScript (no `enum`,
no parameter properties, every relative import spelled `.ts`), so the build
compiles instead and the image carries JavaScript and its source maps only.

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
