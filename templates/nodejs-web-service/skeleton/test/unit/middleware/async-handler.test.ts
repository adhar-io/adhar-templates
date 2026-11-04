// An async route handler wrapped in asyncHandler, inside a real Express app
// with the service's error handler: a rejection must end as a problem
// document, not as a request that never answers.
import express from 'express';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asyncHandler } from '../../../src/middleware/async-handler';
import { errorHandler } from '../../../src/middleware/error-handler';
import type { ProblemDocument } from '../../../src/types';
import { json, withServer } from '../../support/http';
import { recordingLogger } from '../../support/logger';

function appWith(handler: Parameters<typeof asyncHandler>[0]) {
  const { logger, lines } = recordingLogger();
  const app = express();
  app.get('/work', asyncHandler(handler));
  app.use(errorHandler({ logger }));
  return { app, lines };
}

test('what an async handler sends is the response', async () => {
  const { app } = appWith(async (_req, res) => {
    res.json({ done: await Promise.resolve(true) });
  });
  await withServer(app, async (url) => {
    const res = await fetch(`${url}/work`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { done: true });
  });
});

test('a rejection is passed to the error handler: a logged 500 problem, not a hung request', async () => {
  const { app, lines } = appWith(() => Promise.reject(new Error('lost the connection to 10.0.0.7')));
  await withServer(app, async (url) => {
    const res = await fetch(`${url}/work`, { signal: AbortSignal.timeout(5000) });
    assert.equal(res.status, 500);
    assert.deepEqual(await json<ProblemDocument>(res), { type: 'about:blank', title: 'Internal Server Error', status: 500 });
  });
  const logged = lines.find((entry) => entry.level === 'error');
  assert.ok(logged, 'the rejection was not logged');
  assert.equal(logged.err?.message, 'lost the connection to 10.0.0.7');
});
