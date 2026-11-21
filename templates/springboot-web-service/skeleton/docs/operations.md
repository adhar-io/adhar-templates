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
| `CreateContainerConfigError` | a referenced Secret does not exist yet | on a first deploy, wait — the database/cache Secret appears once provisioning finishes; otherwise check the claim in `deploy/` |
| `401` on every request | no or invalid bearer token | expected when authentication is on — send a JWT from the `adhar` realm |
| `Running` but not `Ready` | readiness probe failing | the pod is getting no traffic; check the probe path and timeout |
| `OOMKilled` | memory limit below actual need | raise the limit in `deploy/rollout.yaml`; do not lower the request to compensate |

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

{%- if values.inServiceBatch %}
## In-service batch jobs

The jobs in `src/main/java/io/adhar/service/batch/` run inside this service, on
Adhar Kit's clustered Quartz scheduler, not as platform `BatchJob`s.

| Question | Where to look |
| --- | --- |
| What is scheduled, when does it fire next? | Console → Develop → Batch, or `adhar batch schedules -n <namespace>`: both read the `${{ values.name }}-batch-schedules` ConfigMap |
| What did a run do? | the service's logs, filtered by `batch.run` (the run's name) |
| Is the scheduler healthy? | `adhar_batch_scheduler_fires_total` and `adhar_batch_scheduler_next_fire_seconds` on the **Metrics** tab |

- **`BatchInServiceRunFailed`.** A fire could not start its run, or a run ended
  FAILED. Read the run's log lines first. A failed run is restarted from its
  last commit at its trigger's next fire, so a transient cause heals itself; a
  bad payment is skipped and kept in `batch.adhar_batch_dead_letter`.
- **`BatchInServiceScheduleStalled`.** A trigger is more than ten minutes past
  its next fire: no replica is acquiring triggers (the database is unreachable,
  or no replica is up), or one run is holding its job long past its next slot.
- **Run, stop and restart buttons** do not apply: the Console's batch actions
  act on Kubernetes objects, and an in-service run is not one. To run a day
  again, call `BatchTriggers.fireNow` from the service's own code; a day that
  COMPLETED stays completed (its identity is the business date and cycle).
- **The schedule view is empty** while every write of the report fails, which
  the scheduler counts (`adhar_batch_scheduler_report_failures_total`): the
  service's ServiceAccount lacks the Role in `deploy/base/rbac.yaml`.

{%- endif %}
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
