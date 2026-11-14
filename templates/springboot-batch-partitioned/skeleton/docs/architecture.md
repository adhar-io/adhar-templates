# Architecture

The generated job follows the platform's batch model (design 0025, §5.10, §9.2):

- `deploy/base/batchjob.yaml` declares the job once — `mode: partitioned`,
  `workers`, `gridSize`, schedule, parameters, resources, SLA, alerts — and
  `deploy/envs/<env>` places it in dev (schedule suspended), test and prod
  (critical priority)
- the platform composes from it, per environment, the run's pods: a Volcano
  gang of one manager and `workers` workers in the namespace's queue where
  Volcano runs, one Indexed Job without it; the schedule, the run template the
  Console and `adhar batch run` start runs from, the runner's ServiceAccount and
  the alert rules. Nothing in this repository writes a CronJob or a Volcano Job
- every pod runs the same image; the kit's runner reads its part from
  `ADHAR_BATCH_ROLE` and builds the half of `ImportJobConfiguration` that role
  needs
- the manager splits `public.batch_input` into key ranges
  (`SqlKeyRangePartitioner`) once per run identity and records that plan;
  every restart is split from it, so a partition keeps its range however the
  table changes
- the partition requests go through `batch.INT_CHANNEL_MESSAGE` in the job's
  own PostgreSQL: one message group per run identity, a single
  `DELETE … RETURNING` per claim, and the JobRepository guaranteeing each
  partition runs once. A request left from a failed attempt is discarded
- a worker's chunk — reads, upserts into `public.batch_output`, Spring Batch's
  progress — is one transaction: a restart resumes after the last commit, and
  a worker the manager gave up on cannot commit again (its partition is
  marked FAILED, so its next commit fails on the step execution's version)
- the run's identity is its identifying parameters (`businessDate`,
  `source`), computed alike by the manager and every worker; the same day is
  the same JobInstance whoever starts it
- metrics are pushed to the platform's collector over OTLP; logs and traces
  carry the job, the execution and the partition (`batch.partition` in the MDC)
