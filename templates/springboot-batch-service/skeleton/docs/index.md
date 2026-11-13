# ${{ values.name }}

${{ values.description }}

This job runs enterprise Spring Batch work on the Adhar platform: declared once
as a `BatchJob` in `deploy/`, run by the platform as one Kubernetes run per
business day, restartable from its last commit. The scaffold shows a
partitioned chunk-oriented job, the platform's run launcher, and the Adhar Kit
metrics, logging and exit-code contract that go with it.
