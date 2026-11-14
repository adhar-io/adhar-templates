# ${{ values.name }}

${{ values.description }}

This job runs enterprise Spring Batch work on the Adhar platform, spread over a
manager and ${{ values.workers }} worker pods per run: declared once as a `BatchJob`
with `mode: partitioned` in `deploy/`, run by the platform as a Volcano gang (or
an Indexed Job without Volcano), restartable partition by partition from the
last commit.

- [Architecture](architecture.md): how a run is split, and why it never writes a row twice
- [Operations](operations.md): running, stopping, restarting and sizing it
