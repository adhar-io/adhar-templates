// The application's handle on OpenTelemetry. The SDK itself is started by
// ./instrumentation.ts, which deploy/base/rollout.yaml preloads (NODE_OPTIONS)
// so that it runs before anything else is required. Without the preload —
// `npm start` on a laptop, the unit tests — nothing is registered here, every
// function below is a no-op, and nothing needs a collector to run.
//
// This module imports nothing from OpenTelemetry: the interfaces below are the
// parts of it the module uses, and instrumentation.ts registers the real SDK
// and API against them (so the compiler checks that they fit).

export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
}

// The two calls of the OpenTelemetry API this module makes.
export interface TelemetryApi {
  readonly trace: { getActiveSpan(): { spanContext(): SpanContext } | undefined };
  isSpanContextValid(spanContext: SpanContext): boolean;
}

export interface TelemetryHandle {
  readonly sdk: { shutdown(): Promise<void> };
  readonly api: TelemetryApi;
}

// The trace a log line belongs to: both ids, or neither.
export interface TraceFields {
  readonly trace_id?: string;
  readonly span_id?: string;
}

let registered: TelemetryHandle | null = null;
let flushing: Promise<void> | null = null;

// Called by ./instrumentation.ts once the SDK has started: the SDK, and the
// OpenTelemetry API it registered its providers with.
export function register(handle: TelemetryHandle): void {
  registered = handle;
  flushing = null;
}

// The trace and span the calling code runs in, as log fields:
// { trace_id, span_id }, or {} when nothing is being traced.
export function traceContext(): TraceFields {
  if (!registered) return {};
  const ctx = registered.api.trace.getActiveSpan()?.spanContext();
  if (!ctx || !registered.api.isSpanContextValid(ctx)) return {};
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

// Exports what is still buffered — the last spans, the last metric interval —
// and stops the exporters. src/server.ts calls it after the server has
// closed, so the requests that finished during the stop are in it. Safe to
// call more than once, and without an SDK.
export function shutdown(): Promise<void> {
  if (!registered) return Promise.resolve();
  flushing ??= registered.sdk.shutdown();
  return flushing;
}
