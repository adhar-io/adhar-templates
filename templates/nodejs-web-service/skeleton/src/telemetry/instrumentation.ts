// OpenTelemetry for this service: traces, metrics and logs over OTLP to the
// platform's collector (Alloy), which hands them on to Tempo, Mimir and Loki.
//
// PRELOADED, never imported by the application. deploy/base/rollout.yaml sets
//   NODE_OPTIONS=--require ./dist/telemetry/instrumentation.js
// (this file, compiled) because instrumentation patches modules as they load:
// one required before this file (express, http, pg) is never traced. The
// integration tests preload it the same way; a plain `npm start` does not, so
// a laptop needs no collector.
//
// What is exported, and where to, comes from the OTEL_* variables the Rollout
// sets — exporters, endpoint, protocol, resource attributes, resource
// detectors — exactly as with @opentelemetry/auto-instrumentations-node/register,
// with the same instrumentations and detectors. One thing is different: this
// does not listen for SIGTERM. src/server.ts owns the stop, and flushes the
// telemetry through ./index.ts after the last request has finished.
import { getNodeAutoInstrumentations, getResourceDetectors } from '@opentelemetry/auto-instrumentations-node';
import { api, NodeSDK } from '@opentelemetry/sdk-node';

import { register } from './index';

const sdk = new NodeSDK({
  instrumentations: getNodeAutoInstrumentations(),
  resourceDetectors: getResourceDetectors(),
});

try {
  sdk.start();
  register({ sdk, api });
} catch (err) {
  // Telemetry must never take the service down: serve without it, and say so.
  const { name, message } = err instanceof Error ? err : new Error(String(err));
  process.stderr.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level: 'error',
      msg: 'OpenTelemetry did not start; serving without telemetry',
      err: { name, message },
    })}\n`,
  );
}
