# Architecture

The generated batch job follows the platform's batch model (design 0025):

- `deploy/base/batchjob.yaml` declares the job once — schedule, parameters,
  resources, SLA, alerts — and `deploy/envs/<env>` places it in dev (schedule
  suspended), test and prod (critical priority)
- the platform composes from it, per environment, a CronJob, the run template
  the Console and `adhar batch run` start runs from, the runner's
  ServiceAccount and the alert rules; nothing in this repository writes a
  CronJob
- every run is one Kubernetes Job with one pod: `PlatformRunLauncher` reads the
  run contract (`ADHAR_BATCH_*`), runs the one Spring Batch job and exits with
  the kit's exit code, which the Job's failure policy reads — retryable
  failures replace the pod and resume from the last commit, invalid requests do
  not
- the run's identity is its identifying parameters (`businessDate`, `source`),
  so the same day is the same JobInstance whoever starts it
- Spring Batch's metadata lives in the job's own PostgreSQL
  (`deploy/base/database.yaml`, CloudNativePG, backed up), in the `batch`
  schema that adhar-kit-batch migrates; business tables stay in `public`
- Spring Batch executes a partitioned, chunk-based step built with Adhar Kit's
  step builders, fault-tolerance presets and listeners
- metrics are pushed to the platform's collector over OTLP (a run pod lives
  minutes, too short to be scraped); logs and traces go through Adhar Kit
- Prometheus alerts on failed, late, stuck and OOM-killed runs; Grafana's
  `batch-jvm` dashboard and the Console's Batch area show the runs

This makes the app suitable for enterprise batch workloads without adding extra
frameworking beyond the platform defaults.
