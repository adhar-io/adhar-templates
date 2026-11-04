import type { RequestHandler } from 'express';

import type { Logger } from '../lib/logger';
import { traceContext as activeTraceContext, type TraceFields } from '../telemetry';

export interface RequestLoggerOptions {
  readonly logger: Logger;
  // Paths never logged.
  readonly skip?: readonly string[];
  readonly traceContext?: () => TraceFields;
}

// One JSON line per request, written once the response is sent: method, path,
// status and duration, plus the trace_id that links it to the request's trace
// in Tempo. The query string is left out (it is where tokens end up), and so
// are the probe paths: the kubelet calls /healthz on every pod every few
// seconds, which would bury everything else.
export function requestLogger({
  logger,
  skip = ['/healthz'],
  traceContext = activeTraceContext,
}: RequestLoggerOptions): RequestHandler {
  return (req, res, next) => {
    if (skip.includes(req.path)) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    const path = req.path;
    // Read now, while this request's span is the active one.
    const trace = traceContext();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info('request', {
        method: req.method,
        path,
        status: res.statusCode,
        duration_ms: Math.round(durationMs * 10) / 10,
        ...trace,
      });
    });
    next();
  };
}
