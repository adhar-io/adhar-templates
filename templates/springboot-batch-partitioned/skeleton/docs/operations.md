# Operations

## Run

- **Scheduled**: test and prod run on `schedule` (dev suspends it).
- **Manually**: `adhar batch run ${{ values.name }} --param businessDate=2026-11-03`,
  or the Console's Batch area. Re-running a day that completed is a no-op;
  re-running a day that failed restarts it.

## Watch a run

`adhar batch runs ${{ values.name }}` lists runs; a run's manager log ends with
the termination summary (`read`, `written`, `skipped`, per-partition steps).
Each worker logs the partitions it served (`worker served N partition(s)`).

## Stop and resume

- `adhar batch stop <run>` stops the run: the manager and every worker stop
  at a chunk boundary. `adhar batch resume <run>` (or running the same day
  again) resumes it — only unfinished partitions run, each from its last
  commit.
- A worker stopped on its own (a node drain) stops only its partition; the run
  fails retryable (exit 5) and its retry re-runs that partition.

## A worker died

Nothing to do: the manager fails the dead worker's partition, the run exits 5
and the retry (Volcano's gang restart, or the Indexed Job's next attempt)
re-runs the partitions that did not complete. If the run's retries are spent,
run the day again manually.

## Records the job refuses

A record the processor refuses is skipped and written to
`batch.ADHAR_BATCH_DEAD_LETTER` with its reason; the run completes. More than
`batch.skip-limit` in one partition fails the run, not retryable (exit 3): fix
the input, then run the day again — the failed partition restarts.

## Sizing

- **More throughput**: raise `workers` (each is one more pod of `resources`,
  so the gang must fit the environment's quota and queue) and keep `gridSize`
  a few times `workers`.
- **OOM-killed pods** (exit 137, `BatchRunOOMKilled`): raise
  `resources.memory`, or lower `adhar.batch.chunk.size`.
- **The run outgrows its deadline**: the manager stops waiting five minutes
  before the pod's deadline and fails the run retryable; more workers, or a
  longer `timeouts.activeDeadlineSeconds`.
