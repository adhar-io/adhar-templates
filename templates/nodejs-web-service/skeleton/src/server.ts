// The process: read the configuration, build the application, serve it on
// PORT, and stop cleanly. `npm start` runs it compiled (dist/server.js), and
// so does the image: the buildpack starts the "start" script in package.json.
// `npm run dev` runs this file itself, restarting it on every change.
//
// In the cluster, OpenTelemetry is already running when this file loads: it is
// preloaded from dist/telemetry/instrumentation.js (NODE_OPTIONS in
// deploy/base/rollout.yaml), so express, http and pg are instrumented as they
// are required below.
import './lib/source-maps';

import { createApp } from './app';
import { loadConfig } from './config';
{%- if values.withDatabase %}
import { createDatabase } from './db';
{%- endif %}
import { createLogger } from './lib/logger';
import * as telemetry from './telemetry';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, service: config.serviceName });
{%- if values.withDatabase %}
const db = createDatabase({ connectionString: config.databaseUrl, logger });
{%- endif %}
const app = createApp({ config, logger{% if values.withDatabase %}, db{% endif %} });

const server = app.listen(config.port, () => {
  logger.info('listening', { port: config.port });
});

server.on('error', (err) => {
  // Most often EADDRINUSE. Nothing else keeps the process alive, so it ends
  // with this exit code once the error is logged.
  logger.error('cannot serve', { port: config.port, err });
  process.exitCode = 1;
});

// Kubernetes stops a pod with SIGTERM once the preStop sleep in
// deploy/base/rollout.yaml has taken it out of the Service's endpoints. Stop
// taking connections, let the requests in flight finish,{% if values.withDatabase %} close the
// database pool,{% endif %} flush the telemetry LAST — so the final requests are in it —
// and let the process end on its own with exit code 0.
//
// Before this handler existed every rollout, scale-down and node drain waited
// out the 30 s grace period and ended in the kubelet's SIGKILL, exit 137
// (node-svc, 2026-11-04). A request still running after shutdownTimeoutMs is
// cut off with exit code 1 instead, well inside that grace period.
let stopping = false;

async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info('stopping', { signal });
  setTimeout(() => {
    logger.error('still busy after the shutdown timeout, exiting', { timeout_ms: config.shutdownTimeoutMs });
    process.exit(1);
  }, config.shutdownTimeoutMs).unref();

  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
{%- if values.withDatabase %}
  await db.close().catch((err: unknown) => {
    logger.warn('closing the database pool failed', { err });
  });
{%- endif %}
  await telemetry.shutdown().catch((err: unknown) => {
    logger.warn('flushing telemetry failed', { err });
  });
  logger.info('stopped');
}

process.once('SIGTERM', () => {
  void stop('SIGTERM');
});
// Ctrl-C on a laptop takes the same path; a second Ctrl-C ends it at once.
process.once('SIGINT', () => {
  void stop('SIGINT');
});
