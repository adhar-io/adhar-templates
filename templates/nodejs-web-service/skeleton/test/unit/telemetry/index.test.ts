// src/telemetry/index.ts before and after ./instrumentation.ts registers the
// SDK. The tests run in order: the first one sees the module as a plain
// `npm start` does, with no SDK.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as telemetry from '../../../src/telemetry';
import type { SpanContext, TelemetryApi } from '../../../src/telemetry';

const INVALID_TRACE_ID = '0'.repeat(32);

// The two calls of the OpenTelemetry API the module makes, over a fixed span.
function fakeApi(spanContext: SpanContext | undefined): TelemetryApi {
  return {
    trace: { getActiveSpan: () => (spanContext ? { spanContext: () => spanContext } : undefined) },
    isSpanContextValid: (ctx) => ctx.traceId !== INVALID_TRACE_ID,
  };
}

const noSdk = { shutdown: () => Promise.resolve() };

test('without the preload there are no trace fields, and shutdown resolves', async () => {
  assert.deepEqual(telemetry.traceContext(), {});
  await telemetry.shutdown();
});

test('with an SDK registered, the active span becomes log fields', () => {
  const span = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', traceFlags: 1 };
  telemetry.register({ sdk: noSdk, api: fakeApi(span) });
  assert.deepEqual(telemetry.traceContext(), { trace_id: span.traceId, span_id: span.spanId });
});

test('no active span, or an invalid one, gives no fields', () => {
  telemetry.register({ sdk: noSdk, api: fakeApi(undefined) });
  assert.deepEqual(telemetry.traceContext(), {});
  telemetry.register({ sdk: noSdk, api: fakeApi({ traceId: INVALID_TRACE_ID, spanId: '0'.repeat(16), traceFlags: 0 }) });
  assert.deepEqual(telemetry.traceContext(), {});
});

test('shutdown flushes the SDK once, however often it is called', async () => {
  let flushes = 0;
  const sdk = {
    shutdown: () => {
      flushes += 1;
      return Promise.resolve();
    },
  };
  telemetry.register({ sdk, api: fakeApi(undefined) });
  await Promise.all([telemetry.shutdown(), telemetry.shutdown()]);
  await telemetry.shutdown();
  assert.equal(flushes, 1);
});
