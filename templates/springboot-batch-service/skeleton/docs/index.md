# ${{ values.name }}

${{ values.description }}

This job runs enterprise Spring Batch work on the Adhar platform: declared once
as a `BatchJob` in `deploy/`, run by the platform as one Kubernetes run per
business day, restartable from its last commit. The scaffold shows a
partitioned chunk-oriented job, the Adhar Kit runner that starts it, and the
Adhar Kit metrics, logging and exit-code contract that go with it.

## The platform path, or in-service?

This repository is the **platform path**: every run is its own pod, which the
platform schedules, retries, alerts on and lets operators run, stop, restart
and hold from the Console and `adhar batch`. It is the default for batch work,
and the right home for a job that is long, memory-heavy or partitioned, or that
operators must be able to act on.

Some jobs belong inside a long-running service instead. Scaffold a
**Spring Boot Service** (`springboot-web-service`) with
**In-service batch jobs (Quartz)** for those: the jobs run on Adhar Kit's
clustered Quartz scheduler, in the service's own pods and database (design
0025 §5.20).

| Need | This template (a platform `BatchJob`) | In-service (Quartz) |
| --- | --- | --- |
| Cadence | 10 minutes or more: every run pays a JVM start | down to seconds |
| Triggered by the service's own events (a request, a message, a received file) | no; Console and CLI "run now" only | yes: durable one-shot triggers, one run per identity |
| Business-hours intervals ("every 5 minutes, 09:00–17:00, business days") | no | yes: a daily trigger on a calendar |
| Business calendars | a non-business day runs and exits `skipped(calendar)` | an excluded day never fires |
| A run dies mid-way | the platform replaces the pod; the run resumes from its last commit | another replica re-fires it; it resumes from its last commit |
| Own resources, queue, gang, Kargo verification | yes | no: it shares the service's pod and its request traffic |
| Console and CLI | run, stop, restart, hold, history | a read-only schedule view |

Choose in-service for small, frequent or event-driven work that needs the
service's own state and finishes well inside the service's shutdown timeout;
a rollout of the service stops it. Everything else stays here.
