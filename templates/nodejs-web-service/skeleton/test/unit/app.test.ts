// The application wired together and served in-process: what a client sees —
// routes, error bodies, headers — and what the service logs about it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import type { AppDependencies, ProblemDocument } from '../../src/types';
import { json, withServer } from '../support/http';
import { recordingLogger } from '../support/logger';
{%- if values.withDatabase %}

// A database that answers with a fixed clock, unless a test passes its own.
const fixedClock: AppDependencies['db'] = { now: () => Promise.resolve(new Date('2026-01-01T00:00:00Z')) };
{%- endif %}

function build(deps: Partial<AppDependencies> = {}) {
  const { logger, lines } = recordingLogger();
  return { app: createApp({ config: loadConfig({}), logger{% if values.withDatabase %}, db: fixedClock{% endif %}, ...deps }), lines };
}

test('GET / names the service', async () => {
  await withServer(build().app, async (url) => {
    const res = await fetch(`${url}/`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { service: '${{ values.name }}', status: 'ok' });
  });
});

test('GET /healthz answers ok', async () => {
  await withServer(build().app, async (url) => {
    const res = await fetch(`${url}/healthz`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });
});

test('responses do not name the framework', async () => {
  await withServer(build().app, async (url) => {
    const res = await fetch(`${url}/`);
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

test('a path no route answers is a 404 problem document', async () => {
  await withServer(build().app, async (url) => {
    const res = await fetch(`${url}/no/such/thing`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/);
    assert.deepEqual(await res.json(), {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'No route for GET /no/such/thing',
    });
  });
});

test('a malformed JSON body is a 400 problem, not a 500', async () => {
  const { app, lines } = build();
  await withServer(app, async (url) => {
    const res = await fetch(`${url}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name": ',
    });
    assert.equal(res.status, 400);
    const body = await json<ProblemDocument>(res);
    assert.equal(body.title, 'Bad Request');
    assert.equal(body.status, 400);
  });
  assert.ok(!lines.some((entry) => entry.level === 'error'), 'a client mistake was logged as a server error');
});

test('each request but the probe is logged once, without its query string', async () => {
  const { app, lines } = build();
  await withServer(app, async (url) => {
    await (await fetch(`${url}/?token=secret-value`)).arrayBuffer();
    await (await fetch(`${url}/healthz`)).arrayBuffer();
  });
  const requests = lines.filter((entry) => entry.msg === 'request');
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.ok(request);
  assert.equal(request.method, 'GET');
  assert.equal(request.path, '/');
  assert.equal(request.status, 200);
  assert.ok(!JSON.stringify(lines).includes('secret-value'), 'the query string reached the log');
});
{%- if values.withDatabase %}

test('GET /db reports the database clock', async () => {
  await withServer(build().app, async (url) => {
    const res = await fetch(`${url}/db`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { db: 'ok', now: '2026-01-01T00:00:00.000Z' });
  });
});
{%- endif %}
