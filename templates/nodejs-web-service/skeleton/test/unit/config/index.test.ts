import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from '../../../src/config';

test('with nothing set: the port the container exposes, info logs, a 20 s stop', () => {
  const config = loadConfig({});
  assert.equal(config.serviceName, '${{ values.name }}');
  assert.equal(config.port, ${{ values.port }});
  assert.equal(config.logLevel, 'info');
  assert.equal(config.shutdownTimeoutMs, 20000);
});

test('reads PORT, LOG_LEVEL and SHUTDOWN_TIMEOUT_MS from the environment', () => {
  const config = loadConfig({ PORT: '8081', LOG_LEVEL: ' DEBUG ', SHUTDOWN_TIMEOUT_MS: '5000' });
  assert.equal(config.port, 8081);
  assert.equal(config.logLevel, 'debug');
  assert.equal(config.shutdownTimeoutMs, 5000);
});

test('an empty variable counts as unset', () => {
  assert.equal(loadConfig({ PORT: '', SHUTDOWN_TIMEOUT_MS: ' ' }).port, ${{ values.port }});
});

test('a setting that is set but invalid stops startup, naming the variable', () => {
  assert.throws(() => loadConfig({ PORT: 'http' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ PORT: '3000.5' }), /PORT/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /LOG_LEVEL/);
  assert.throws(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: '-1' }), /SHUTDOWN_TIMEOUT_MS/);
});

test('the configuration cannot be changed after startup', () => {
  assert.ok(Object.isFrozen(loadConfig({})));
});
{%- if values.withDatabase %}

test('DATABASE_URL is passed through, and is absent when unset', () => {
  assert.equal(loadConfig({ DATABASE_URL: 'postgresql://app@db.example:5432/app' }).databaseUrl, 'postgresql://app@db.example:5432/app');
  assert.equal(loadConfig({}).databaseUrl, undefined);
});
{%- endif %}
