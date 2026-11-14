# ${{ values.name }}

${{ values.description }}

A Spring Batch job on the Adhar platform that spreads each run over **one
manager and ${{ values.workers }} worker pods** (remote partitioning), pre-configured
with **Adhar Kit**: declared once in Git as a `BatchJob` with
`mode: partitioned`, restartable partition by partition from the last commit,
with its own backed-up PostgreSQL for the business tables, the Spring Batch
metadata and the partition channel.

## What is included

- `ImportJobConfiguration`: ONE configuration for every pod. The job and its
  manager step exist in every role; the worker step, its reader, processor and
  writer only where partitions run (`@ConditionalOnBatchRole(WORKER)`)
- `SqlKeyRangePartitioner` over `public.batch_input` (equal row counts per
  partition), a keyset reader per partition range, an upsert writer into
  `public.batch_output`, skip + dead letter for records the processor refuses
- the kit's runner (`AdharBatchApplication`): the role, the parameters and the
  business date from the run contract every pod carries, the exit codes, a
  termination summary
- `deploy/base/batchjob.yaml`: the `BatchJob` the platform composes the gang,
  the schedule, the run template, the runner's identity and the alert rules
  from; `deploy/envs/<env>` places it in dev (schedule suspended), test and
  prod (critical priority)
- `PartitionedJobIT`: a manager and two workers on one PostgreSQL, a worker
  killed mid-partition, the gang restarted, every row written exactly once

## How a run works

| Pod | `ADHAR_BATCH_ROLE` | Does |
|---|---|---|
| manager | `manager` (or `indexed`, index 0) | splits `batch_input` into `gridSize` key ranges and writes one request per range into the partition channel (`batch.INT_CHANNEL_MESSAGE`); waits for them; exits with the run's code |
| worker × ${{ values.workers }} | `worker` (or `indexed`, index > 0) | claims a request, runs `importStep` over that range in chunks of `adhar.batch.chunk.size`, claims the next; ends when the run COMPLETED |

Where Volcano runs, the pods are one gang: all ${{ values.workers }}+1 start together or
none do, a worker that dies restarts the gang, and the manager completing ends
the workers. Without Volcano the run is one Indexed Job (index 0 the manager)
and the rest is the same. The partitions travel through the job's own
database, so there is no broker.

A run's identity is its **identifying parameters**, declared on the job with
`@AdharBatchJob` and in `deploy/base/batchjob.yaml` (`BatchJobContractTest`
fails the build when they differ):

| Parameter | Type | Where it comes from |
|---|---|---|
| `businessDate` | date | A scheduled run derives it from the scheduled time in the job's time zone; a manual run states it |
| `source` | `database` | The input; the only one the sample reads |

## Restarts and exactly-once

- A worker killed mid-partition (OOM, SIGKILL, a lost node) costs one restart
  of **that partition**, from its last commit: the manager fails it (at once
  on the platform, where it watches the worker pods), the run exits 5, and
  the retry — Volcano's gang restart, or the Indexed Job's next attempt —
  re-runs only the partitions that did not complete.
- A chunk's reads, its upserts and Spring Batch's progress are one
  transaction, so a worker that was given up on cannot commit into a
  partition that runs again: its commit fails and its writes roll back.
- The writer upserts on `id`, so a row written twice is one row.

| Exit | Meaning | Kubernetes |
|---|---|---|
| 0 | completed, or a no-op (already complete, a duplicate run still alive) | success |
| 2 | invalid request: unknown job, bad parameter, no business date, an unsupported setting | fails the run, no retry |
| 3 | failed, not retryable (`NonRetryableBatchException`, skip limit) | fails the run, no retry |
| 4 | stopped on request | fails the run, no retry |
| 5 | failed, retryable — including a partition whose worker died or was stopped | the run is retried; only unfinished partitions run again |
| 6 / 7 | abandoned / repository state unknown | fails the run, no retry |

## Sizing

`workers` and `gridSize` are independent. Each worker is one more pod of
`resources` (1 CPU / 1536Mi by default), so the gang must fit the
environment's quota and Volcano queue: the default two workers fit an
environment's default 4 CPU / 8Gi. Make `gridSize` a few times `workers`, so
a slow range does not leave the other workers idle.

## Local development

Requires JDK 25 and Maven 3.9+ — or open the folder in its development
container (`.devcontainer/`, see its README), which carries both plus the
platform's tools.

```bash
docker compose up -d          # PostgreSQL on localhost:5432
mvn spring-boot:run           # one run for today, manager and partitions in this process
mvn verify                    # unit tests and the Testcontainers ITs (Docker needed)
```

## Documentation

- [Architecture](docs/architecture.md)
- [Operations](docs/operations.md)
