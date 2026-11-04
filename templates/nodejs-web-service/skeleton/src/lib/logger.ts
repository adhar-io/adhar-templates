import { traceContext as activeTraceContext, type TraceFields } from '../telemetry';

// Structured logs: one JSON object per line — on stdout, errors on stderr —
// which the platform collects into Loki from the container's output. A line
// written while a request is handled carries that request's trace_id and
// span_id, and Grafana's Loki data source turns trace_id into a link to the
// trace in Tempo.

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;
export const LOG_LEVELS = Object.keys(LEVELS) as readonly LogLevel[];

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

// Where the lines go: process.stdout and process.stderr, or a test's array.
export interface LineSink {
  write(line: string): unknown;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly service: string;
  readonly stdout?: LineSink;
  readonly stderr?: LineSink;
  readonly traceContext?: () => TraceFields;
}

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(LEVELS, value);
}

// JSON.stringify turns an Error into {}; keep what explains it.
function toJSONValue(value: unknown): unknown {
  if (!(value instanceof Error)) return value;
  const out: Record<string, unknown> = { name: value.name, message: value.message };
  const { code } = value as Error & { code?: unknown };
  if (code !== undefined) out.code = code;
  out.stack = value.stack;
  return out;
}

export function createLogger({
  level = 'info',
  service,
  stdout = process.stdout,
  stderr = process.stderr,
  traceContext = activeTraceContext,
}: LoggerOptions): Logger {
  // The type rules out anything else; a caller that is not type-checked can
  // still pass it.
  if (!isLogLevel(level)) throw new Error(`unknown log level "${String(level)}"`);
  const threshold = LEVELS[level];

  function write(entryLevel: LogLevel, msg: string, fields: LogFields = {}): void {
    if (LEVELS[entryLevel] < threshold) return;
    const entry: Record<string, unknown> = { time: new Date().toISOString(), level: entryLevel, service, msg, ...traceContext() };
    for (const [key, value] of Object.entries(fields)) entry[key] = toJSONValue(value);
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      // A field that cannot be serialised (a cycle) must not lose the message.
      line = JSON.stringify({ time: entry.time, level: entryLevel, service, msg, log_error: 'fields not serialisable' });
    }
    (LEVELS[entryLevel] >= LEVELS.error ? stderr : stdout).write(`${line}\n`);
  }

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
