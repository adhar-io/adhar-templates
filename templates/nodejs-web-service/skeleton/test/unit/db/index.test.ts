{% if values.withDatabase -%}
// src/db against a real node-postgres pool pointed at a port nothing listens
// on (1): creating the pool connects to nothing, and every query fails fast.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDatabase } from '../../../src/db';
import { recordingLogger } from '../../support/logger';

const UNREACHABLE = 'postgresql://127.0.0.1:1/app';

test('a connection the server drops while idle is logged, not a crash', async () => {
  const { logger, lines } = recordingLogger();
  const db = createDatabase({ connectionString: UNREACHABLE, logger });
  // What node-postgres emits when PostgreSQL closes an idle connection.
  assert.doesNotThrow(() => db.pool.emit('error', new Error('terminating connection due to administrator command')));
  assert.equal(lines.length, 1);
  const [line] = lines;
  assert.ok(line);
  assert.equal(line.level, 'warn');
  assert.match(line.err?.message ?? '', /terminating connection/);
  await db.close();
});

test('a query against a database that does not answer rejects', async () => {
  const db = createDatabase({ connectionString: UNREACHABLE, logger: recordingLogger().logger });
  await assert.rejects(db.now(), /ECONNREFUSED/);
  await db.close();
});
{%- else -%}
import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as db from '../../../src/db';

// This service was scaffolded without a database (withDatabase: false).
test('there is no database module', () => {
  assert.deepEqual(Object.keys(db), []);
});
{%- endif %}
