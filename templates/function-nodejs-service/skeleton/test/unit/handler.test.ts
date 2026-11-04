// The function itself, without HTTP: an invocation in, its answer out.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../../src/config';
import { type Invocation, invoke } from '../../src/handler';

const fn = loadConfig({});

function invocation(overrides: Partial<Invocation> = {}): Invocation {
  return { method: 'GET', path: '/', headers: {}, event: null, body: Buffer.alloc(0), ...overrides };
}

test('answers with what invoked it, and when', async () => {
  const result = await invoke(invocation({ method: 'POST', path: '/orders', body: Buffer.from('{"id":7}') }), fn);
  assert.equal(result.ok, true);
  assert.equal(result.function, ${{ values.name | dump }});
  assert.equal(result.runtime, 'node24');
  assert.equal(result.trigger, 'http');
  assert.equal(result.method, 'POST');
  assert.equal(result.path, '/orders');
  assert.equal(result.event, null);
  assert.equal(result.received, 8);
  assert.ok(!Number.isNaN(Date.parse(result.at)), `at is not a timestamp: ${result.at}`);
});

test('an event names its CloudEvent type', async () => {
  const result = await invoke(invocation({ method: 'POST', event: 'com.example.ping' }), fn);
  assert.equal(result.event, 'com.example.ping');
});
