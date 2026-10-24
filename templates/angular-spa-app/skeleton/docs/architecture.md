# Architecture

## Request path

```
client → Cilium Gateway (TLS) → HTTPRoute ${{ values.hostname }} → Service ${{ values.name }} → pod :${{ values.port }}
```

`deploy/httproute.yaml` attaches to the platform's shared Gateway. The hostname
is the one thing in that file worth reading carefully — it is what makes the
service reachable, and it must stay under the platform's base domain for the
wildcard certificate to cover it.

The build produces a static bundle served by a small web server in the
container. There is no server-side rendering, so every request for a route
returns `index.html` and the router resolves it in the browser.
{%- if values.withCms %}

## Content from Strapi

```text
browser → GET /cms/${{ values.cmsCollection }}?locale=… → nginx
        → http://strapi.adhar-system.svc.cluster.local:1337/api/${{ values.cmsCollection }}  (+ read-only token)
```

The platform runs one Strapi for every app, inside the cluster. Its public
address is behind single sign-on, so the app reaches it server-side: nginx (`nginx-app.conf`)
answers `/cms/` and `/uploads/` on the app's own origin and adds the token from
the Secret `${{ values.name }}-strapi`. Consequences worth knowing:

- **The token never reaches the browser,** and the browser's cookies never reach
  Strapi. Make it **read-only** — better, a custom token limited to `find` and
  `findOne` on this app's content types: the CMS is shared, and a broad token
  reads every app's content.
- **Only GET passes,** and Strapi's `users`, `users-permissions`, `auth`,
  `connect` and `upload` endpoints are refused whatever the token allows.
- **Answers are cached for a minute** (media for a day; Strapi hashes media
  names), so a published edit is live within a minute.
- **Strapi down costs a section, not the page:** the proxy answers 502/504
  quickly and the page says the content could not be loaded.
- **No token yet** is not an error: `/cms/` answers an empty 200 with
  `X-Cms: off` and the page shows how to connect it.
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

## Observability

The service is scraped and its logs collected without any per-service
configuration: the platform's Prometheus selects every ServiceMonitor, Loki
collects container output, and Grafana's dashboards are variable-driven. Emitting
metrics on `/metrics` and logging to stdout is all that is required of the
application.

The Service Catalog's **Metrics** tab queries this workload by name, so keep
`catalog-info.yaml`'s name matching the workload name — that join is what makes
the tab show your service rather than nothing.
