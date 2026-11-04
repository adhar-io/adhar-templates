import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../../src/config';

test('with nothing set: the function name, node24, http, port 8080', () => {
  assert.deepEqual(loadConfig({}), { name: ${{ values.name | dump }}, runtime: 'node24', trigger: 'http', port: 8080 });
});

test('reads what Knative and the Function composition set', () => {
  const config = loadConfig({ PORT: '9090', FUNCTION_NAME: 'renamed', FUNCTION_RUNTIME: 'node26', FUNCTION_TRIGGER: 'http,cron' });
  assert.deepEqual(config, { name: 'renamed', runtime: 'node26', trigger: 'http,cron', port: 9090 });
});

test('an invalid PORT stops startup, naming it', () => {
  assert.throws(() => loadConfig({ PORT: 'http' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '8080.5' }), /PORT/);
});

test('the configuration cannot be changed after startup', () => {
  assert.ok(Object.isFrozen(loadConfig({})));
});
