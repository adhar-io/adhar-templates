import express, { type Router } from 'express';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHealthRouter } from '../../../src/health';
import { withServer } from '../../support/http';
{%- if values.withDatabase %}
import { recordingLogger } from '../../support/logger';
{%- endif %}

function serve(router: Router, fn: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(router);
  return withServer(app, fn);
}

test('GET /healthz answers a plain-text ok', async () => {
{%- if values.withDatabase %}
  // A database that is down: the probe must not care.
  const db = { now: () => Promise.reject(new Error('down')) };
  const router = createHealthRouter({ logger: recordingLogger().logger, db });
{%- else %}
  const router = createHealthRouter();
{%- endif %}
  await serve(router, async (url) => {
    const res = await fetch(`${url}/healthz`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await res.text(), 'ok');
  });
});
{%- if values.withDatabase %}

test('GET /db reports the database clock when PostgreSQL answers', async () => {
  const db = { now: () => Promise.resolve(new Date('2026-01-01T00:00:00Z')) };
  await serve(createHealthRouter({ logger: recordingLogger().logger, db }), async (url) => {
    const res = await fetch(`${url}/db`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { db: 'ok', now: '2026-01-01T00:00:00.000Z' });
  });
});

test('GET /db is a 500 when PostgreSQL does not answer: the reason is logged, not returned', async () => {
  const { logger, lines } = recordingLogger();
  const db = { now: () => Promise.reject(new Error('password authentication failed for user "app"')) };
  await serve(createHealthRouter({ logger, db }), async (url) => {
    const res = await fetch(`${url}/db`);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { db: 'error', error: 'database unavailable' });
    assert.ok(!text.includes('password'), 'the database error reached the client');
  });
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(line);
  assert.equal(line.level, 'warn');
  assert.match(line.err?.message ?? '', /password authentication failed/);
});
{%- endif %}
