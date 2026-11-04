import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLogger, type LoggerOptions } from '../../../src/lib/logger';
import type { LogLine } from '../../support/logger';

function capture(options: Partial<LoggerOptions> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const logger = createLogger({
    level: 'info',
    service: 'svc',
    stdout: { write: (line: string) => out.push(line) },
    stderr: { write: (line: string) => err.push(line) },
    traceContext: () => ({}),
    ...options,
  });
  return { logger, out, err };
}

const parse = (line: string | undefined): LogLine => {
  assert.ok(line !== undefined, 'nothing was written');
  return JSON.parse(line) as LogLine;
};

test('one JSON object per line: time, level, service, message and fields', () => {
  const { logger, out } = capture();
  logger.info('listening', { port: 3000 });
  assert.equal(out.length, 1);
  assert.ok(out[0]?.endsWith('\n'));
  const entry = parse(out[0]);
  assert.equal(entry.level, 'info');
  assert.equal(entry.service, 'svc');
  assert.equal(entry.msg, 'listening');
  assert.equal(entry.port, 3000);
  assert.ok(!Number.isNaN(Date.parse(entry.time)), `time is not a timestamp: ${entry.time}`);
});

test('entries below the configured level are dropped', () => {
  const { logger, out } = capture({ level: 'warn' });
  logger.debug('noise');
  logger.info('noise');
  logger.warn('kept');
  assert.deepEqual(out.map((line) => parse(line).msg), ['kept']);
});

test('errors go to stderr with their name, message, code and stack', () => {
  const { logger, out, err } = capture();
  const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  logger.error('request failed', { err: cause });
  assert.equal(out.length, 0);
  const entry = parse(err[0]);
  assert.equal(entry.err?.name, 'Error');
  assert.equal(entry.err?.message, 'connect ECONNREFUSED');
  assert.equal(entry.err?.code, 'ECONNREFUSED');
  assert.match(entry.err?.stack ?? '', /logger\.test\.ts/);
});

test('a line written inside a trace carries its trace and span ids', () => {
  const ids = { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' };
  const { logger, out } = capture({ traceContext: () => ids });
  logger.info('inside a request');
  const entry = parse(out[0]);
  assert.equal(entry.trace_id, ids.trace_id);
  assert.equal(entry.span_id, ids.span_id);
});

test('a field that cannot be serialised does not lose the message', () => {
  const { logger, out } = capture();
  const loop: Record<string, unknown> = {};
  loop.self = loop;
  logger.info('still here', { loop });
  const entry = parse(out[0]);
  assert.equal(entry.msg, 'still here');
  assert.equal(entry.log_error, 'fields not serialisable');
});

test('an unknown level is refused', () => {
  // @ts-expect-error -- a level the type rules out, as untyped code could still pass
  assert.throws(() => createLogger({ level: 'verbose', service: 'svc' }), /verbose/);
});
