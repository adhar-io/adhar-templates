# ${{ values.name }}

${{ values.description }}

A Spring Batch job on the Adhar platform, pre-configured with **Adhar Kit**:
declared once in Git as a `BatchJob`, run by the platform as one Kubernetes run
per business day, restartable from its last commit, with its own backed-up
PostgreSQL for the Spring Batch metadata.

## Adhar Kit

`adhar-kit-parent` / `adhar-kit-batch` resolve from the platform's Nexus and
provide the step builders, fault-tolerance presets, listeners, operator API,
JobRepository schema management, metrics, logging and the exit-code contract
without any app boilerplate.

## What is included

- a sample partitioned chunk job (`BatchConfiguration`): a manager step slices
  the input into partitions that run concurrently, each a chunk-oriented worker
- the platform's run launcher (`PlatformRunLauncher`): the job, its parameters
  and its business date from the run contract every run pod carries, the kit's
  exit codes, a termination summary
- Spring Batch metadata in the job's own PostgreSQL (`deploy/base/database.yaml`)
- optional Kafka cluster and topic (`deploy/base/kafka.yaml`)
- `deploy/base/batchjob.yaml`: the `BatchJob` the platform composes a CronJob,
  a run template, the runner's identity and alert rules from; `deploy/envs/<env>`
  places it in dev (schedule suspended), test and prod (critical priority)
- metrics pushed to the platform's collector; logs and traces through Adhar Kit
- secure supply chain and GitOps deployment from the platform

## Batch job

The sample job reads a list of payloads — from the classpath file
`src/main/resources/data/input.txt`, the `batch_input` table or the
`batch.items` property, chosen by the run's `source` parameter — transforms
each one and writes it out. The business logic sits in one chunk-based step so
it is easy to replace with a real extraction/processing/load workflow.

A run's identity is its **identifying parameters**, declared in
`deploy/base/batchjob.yaml` and completed by `PlatformRunLauncher`:

| Parameter | Type | Where it comes from |
|---|---|---|
| `businessDate` | date | A scheduled run derives it from the scheduled time in the job's time zone; a manual run states it (the Console's form and `adhar batch run` default it to today) |
| `source` | `file` \| `database` \| `list` | Defaults to `batch.input-type` in `application.properties` |

The same day is therefore the same `JobInstance` whoever starts it: a failed
night re-run by a person restarts from its last commit, and a day that
completed is a no-op. Keep the declaration in `batchjob.yaml` and the constants
in `BatchConfiguration` together.

## How a run is launched

Every run is a Kubernetes Job the platform creates from the `BatchJob` — by its
schedule, or from the composed run template when somebody starts one in the
Console or with `adhar batch run ${{ values.name }}`. The pod carries the run
contract as environment (`ADHAR_BATCH_JOB`, `_NAME`, `_TRIGGER`, `_PARAMS`,
`_TIME_ZONE`, `_K8S_JOB`, the datasource from the database's Secret, and
OpenTelemetry to the platform's collector); `PlatformRunLauncher` reads it,
runs the one job and exits:

| Exit | Meaning | Kubernetes |
|---|---|---|
| 0 | completed, or a no-op (already complete, duplicate) | success |
| 2 | invalid request: unknown job, bad parameter, no scheduled time | fails the run, no retry |
| 3 | failed, not retryable (`NonRetryableBatchException`, skip limit) | fails the run, no retry |
| 4 | stopped on request | fails the run, no retry |
| 5 | failed, retryable | the pod is replaced (twice), and the restart resumes from the last commit |
| 6 / 7 | abandoned / repository state unknown | fails the run, no retry |

There is no web server and no endpoint. A run that is killed (OOM, a node
drain) leaves its execution STARTED; the replacement pod of the same Job
recovers it and restarts from the last commit. An execution another process
left behind is reported as a duplicate — recover it with `adhar batch`.

## Local development

Requires JDK 25 and Maven 3.9+ — or open the folder in its development
container (`.devcontainer/`, see its README), which carries both plus the
platform's tools, the editor extensions and the IntelliJ plugins.

```sh
docker compose up -d          # Postgres{% if values.withKafka %} / Kafka{% endif %} on localhost
mvn -s settings.xml spring-boot:run                      # one run of the sample job for today
ADHAR_BATCH_PARAMS='{"source":"list"}' mvn -s settings.xml spring-boot:run   # another input
mvn -s settings.xml verify                               # unit tests and the ITs (Testcontainers)
```

`compose.yaml` starts the PostgreSQL that Spring Batch reads and writes its
metadata tables in, on the `localhost:5432` that `application.properties` falls
back to; the deployed job gets the CloudNativePG database instead. A second
`spring-boot:run` for the same day is a no-op (exit 0, `already-complete`):
give it another `businessDate` or `source` to run again.
{%- if values.withKafka %}

The completion event goes to the Kafka `compose.yaml` starts on
`localhost:9092`; the deployed job publishes to the cluster `deploy/base/kafka.yaml`
provisions.
{%- endif %}

## Deployment

`deploy/base/batchjob.yaml` is the whole definition: the schedule, the
parameters, the resources, the SLA and the alerts. Argo CD syncs each overlay
in `deploy/envs/<env>` into that environment's namespace; Kargo promotes the
image digest dev → test → prod by editing only the overlay's `images:` block
(`kustomizeconfig.yaml` tells kustomize where a `BatchJob` keeps its image).

| Environment | Schedule | Priority |
|---|---|---|
| dev | suspended — runs are started by a person | standard |
| test | as written | standard |
| prod | as written | critical (never preempts; decides who waits when the cluster is full) |

Operators pause a job without a commit with the `adhar.io/batch-hold`
annotation. The platform composes the alerts `BatchRunFailed`,
`BatchScheduleMissed`, `BatchNoRecentSuccess`, `BatchRunTooLong`,
`BatchRunStuckPending` and `BatchRunOOMKilled` per environment
({% if values.enableAlerts %}on{% else %}off: `alerts.enabled: false`{% endif %} for this job).

## Layout

```
.
├── .devcontainer/       # development container: toolchain, platform tools, editor setup
├── pom.xml
├── settings.xml
├── project.toml
├── compose.yaml         # local backing services for `mvn spring-boot:run`
├── src/main/java/io/adhar/service/
│   ├── Application.java              # a run-to-completion process
│   ├── BatchConfiguration.java       # the sample job and its parameters
│   └── batch/
│       ├── PlatformRun.java          # the run contract (ADHAR_BATCH_*)
│       ├── PlatformRunLauncher.java  # launches the run, exits with the kit's code
│       ├── EnterpriseBatchProperties.java
│       ├── PartitionSliceReader.java
│       └── BatchMetricsListener.java
├── src/main/resources/application.properties
├── deploy/
│   ├── base/
│   │   ├── batchjob.yaml             # the BatchJob the platform composes the run from
│   │   ├── database.yaml             # its PostgreSQL (JobRepository + business tables)
{%- if values.withKafka %}
│   │   ├── kafka.yaml                # its Kafka cluster and topic
{%- endif %}
│   │   ├── kustomization.yaml
│   │   └── kustomizeconfig.yaml      # where kustomize (Kargo) finds the image
│   └── envs/{dev,test,prod}/         # namespace, pinned image, per-environment patches
└── docs/
```
