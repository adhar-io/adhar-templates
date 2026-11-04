// The function behind its HTTP server, served in-process: what Knative, the
// platform Gateway and the event sources see. app-ci runs these with the rest
// of `npm test` on every push, on the Node.js version project.toml pins.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../../src/config';
import type { Handler, InvocationResult } from '../../src/handler';
import { createServer, type ServerOptions } from '../../src/http';
import type { LogFields, LogLevel } from '../../src/log';
import { json, withServer } from '../support/http';

// The server with the real function, and what it logged.
function serve(options: ServerOptions = {}) {
  const logged: { level: LogLevel; msg: string; fields: LogFields }[] = [];
  const server = createServer(loadConfig({}), {
    log: (level, msg, fields = {}) => {
      logged.push({ level, msg, fields });
    },
    ...options,
  });
  return { server, logged };
}

test('GET /healthz answers ok', async () => {
  await withServer(serve().server, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.equal((await json<{ ok: boolean }>(res)).ok, true);
  });
});

test('GET / invokes the function', async () => {
  await withServer(serve().server, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const body = await json<InvocationResult>(res);
    assert.equal(body.ok, true);
    assert.equal(body.method, 'GET');
    assert.equal(body.event, null);
  });
});

test('a CloudEvent POSTed to / is handled', async () => {
  await withServer(serve().server, async (base) => {
    const res = await fetch(`${base}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'ce-type': 'com.example.ping',
        'ce-source': 'test',
        'ce-id': '1',
        'ce-specversion': '1.0',
      },
      body: JSON.stringify({ hello: 'world' }),
    });
    assert.equal(res.status, 200);
    const body = await json<InvocationResult>(res);
    assert.equal(body.event, 'com.example.ping');
    assert.equal(body.received, 17);
  });
});

test('a body over the limit is refused with 413, and the function is not invoked', async () => {
  let invoked = false;
  const handler: Handler = () => {
    invoked = true;
    throw new Error('must not be invoked');
  };
  await withServer(serve({ handler, maxBodyBytes: 16 }).server, async (base) => {
    const res = await fetch(`${base}/`, { method: 'POST', body: 'x'.repeat(64) });
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { ok: false, error: 'request body larger than 16 bytes' });
  });
  assert.equal(invoked, false);
});

test('an error the function throws is a logged 500 that does not show its message', async () => {
  const handler: Handler = () => {
    throw new Error('connect ECONNREFUSED 10.0.0.7:5432');
  };
  const { server, logged } = serve({ handler });
  await withServer(server, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: false, error: 'internal error' });
    assert.ok(!text.includes('10.0.0.7'), 'the error message reached the caller');
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.level, 'error');
  assert.equal(logged[0]?.fields.error, 'connect ECONNREFUSED 10.0.0.7:5432');
});
