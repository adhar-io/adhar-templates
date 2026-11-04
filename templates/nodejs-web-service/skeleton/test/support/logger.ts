import { createLogger, type Logger, type LogLevel } from '../../src/lib/logger';
import type { TraceFields } from '../../src/telemetry';

// An Error as the logger writes it.
export interface LoggedError {
  readonly name: string;
  readonly message: string;
  readonly code?: unknown;
  readonly stack?: string;
}

// One line the logger wrote, parsed back.
export interface LogLine {
  readonly time: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly msg: string;
  readonly err?: LoggedError;
  readonly [field: string]: unknown;
}

// The real logger, writing into an array instead of stdout and stderr: a test
// asserts on what was logged, and the test output stays readable.
export function recordingLogger({
  level = 'debug',
  traceContext = () => ({}),
}: { readonly level?: LogLevel; readonly traceContext?: () => TraceFields } = {}): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const sink = { write: (line: string) => lines.push(JSON.parse(line) as LogLine) };
  const logger = createLogger({ level, service: 'test', stdout: sink, stderr: sink, traceContext });
  return { logger, lines };
}
