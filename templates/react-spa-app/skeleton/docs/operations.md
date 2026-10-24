# Operations

A runbook for `${{ values.name }}`. Everything here is read-only unless it says
otherwise.

## Is it up?

| Question | Where to look |
| --- | --- |
| Is it serving? | https://${{ values.hostname }} |
| Is the rollout healthy? | Service Catalog → `${{ values.name }}` → **Deployment** |
| What is it doing? | Service Catalog → `${{ values.name }}` → **Metrics** |
| Why did it change? | The repo's commit history — every deploy is a commit |

## A rollout is stuck

Argo Rollouts pauses rather than completing a bad canary, which looks like
"stuck" and is usually correct behaviour: it is telling you the new version is
not passing.

1. Check the **Metrics** tab for the canary's error rate and latency against the
   stable pods.
2. If the new version is bad, roll back by reverting the commit. Reverting is the
   rollback — there is no separate rollback button, because the cluster follows
   git.
3. If the new version is fine and the analysis is wrong, fix the analysis
   template rather than forcing the promotion; a gate that cries wolf gets
   ignored the next time it is right.

## Pods will not start

Read the reason before changing anything — the three common causes need opposite
responses:

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `ImagePullBackOff` | the image is not signed, or the node cannot reach the registry | check the build succeeded and the signature verified |
| `CrashLoopBackOff` | the process exits on start | read the logs; this is almost always configuration, not the platform |
| `Running` but not `Ready` | readiness probe failing | the pod is getting no traffic; check the probe path and timeout |
| `OOMKilled` | memory limit below actual need | raise the limit in `deploy/rollout.yaml`; do not lower the request to compensate |
{%- if values.withCms %}

## Content does not show

The home page's CMS section says which case it is:

| It says | Cause | What to do |
| --- | --- | --- |
| Strapi is not connected | no Secret `${{ values.name }}-strapi` (key `api-token`) in this namespace | create it with a read-only Strapi API token and restart the Rollout |
| Nothing published yet | the token works, the collection is empty or unpublished | publish an entry of `${{ values.cmsCollection }}` in Strapi |
| Could not be loaded | Strapi refused the token (401/403), the content type does not exist (404), or Strapi is down (502/504) | `curl -i https://${{ values.hostname }}/cms/${{ values.cmsCollection }}` shows Strapi's own error; a 401/403 means a deleted or too narrow token |

Edits appear within a minute: `/cms/` answers are cached that long.
{%- endif %}

## Changing configuration

Configuration lives in `deploy/rollout.yaml` as environment variables, and
changing it is a commit like any other. Two rules:

- **No secrets in git.** A credential belongs in a Secret referenced by name.
  The platform's policy engine reports plaintext secrets, and a commit is
  forever even after a revert.
- **`kubectl edit` does not stick.** Argo CD self-heals, so an edit made by hand
  is reverted on the next sync — usually within a minute, which is long enough to
  convince you it worked. Change the repo.

## Scaling

Replica count is `${{ values.replicas }}` in `deploy/rollout.yaml`. Raise it
there. If the pods then sit `Pending`, the cluster is out of capacity rather than
the manifest being wrong, and the platform's node autoscaler will add a node —
watch the **Deployment** tab rather than re-applying.

## Improving the scorecard

The platform grades this service on signals it can see for itself. The ones most
often missing on a fresh repo:

- **Probes** — both readiness and liveness, with timeouts above one second.
- **Requests and limits** — set on every container.
- **A pinned image tag** — `:latest` is scored as a failure because it makes a
  rollback meaningless.
- **Backup coverage** — for a stateful service, a schedule that actually exists.

Service Catalog → `${{ values.name }}` → **Scorecard** lists what passed and
what did not, with its own history so you can see whether a change helped.
