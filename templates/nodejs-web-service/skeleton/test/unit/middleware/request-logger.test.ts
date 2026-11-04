import express from 'express';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Logger } from '../../../src/lib/logger';
import { requestLogger } from '../../../src/middleware/request-logger';
import { withServer } from '../../support/http';
import { recordingLogger } from '../../support/logger';

const ids = { trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', span_id: '00f067aa0ba902b7' };

function appLoggingTo(logger: Logger) {
  const app = express();
  app.use(requestLogger({ logger, traceContext: () => ids }));
  app.get('/orders/:id', (req, res) => {
    res.status(201).json({ id: req.params.id });
  });
  app.get('/healthz', (_req, res) => {
    res.send('ok');
  });
  return app;
}

test('a request is logged once it is answered: method, path, status, duration and trace', async () => {
  const { logger, lines } = recordingLogger();
  await withServer(appLoggingTo(logger), async (url) => {
    await (await fetch(`${url}/orders/7?token=secret-value`)).arrayBuffer();
  });
  assert.equal(lines.length, 1);
  const [entry] = lines;
  assert.ok(entry);
  assert.equal(entry.msg, 'request');
  assert.equal(entry.method, 'GET');
  assert.equal(entry.path, '/orders/7');
  assert.equal(entry.status, 201);
  assert.equal(typeof entry.duration_ms, 'number');
  assert.equal(entry.trace_id, ids.trace_id);
  assert.equal(entry.span_id, ids.span_id);
  assert.ok(!JSON.stringify(entry).includes('secret-value'), 'the query string reached the log');
});

test('the probe path is not logged', async () => {
  const { logger, lines } = recordingLogger();
  await withServer(appLoggingTo(logger), async (url) => {
    await (await fetch(`${url}/healthz`)).arrayBuffer();
  });
  assert.equal(lines.length, 0);
});
