import express, { type RequestHandler } from 'express';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorHandler, notFound } from '../../../src/middleware/error-handler';
import type { ProblemDocument } from '../../../src/types';
import { json, withServer } from '../../support/http';
import { recordingLogger } from '../../support/logger';

const failWith =
  (props: { message: string; status: number; expose?: boolean }): RequestHandler =>
  (_req, _res, next) => {
    next(Object.assign(new Error(props.message), props));
  };

function failingApp() {
  const { logger, lines } = recordingLogger();
  const app = express();
  app.get('/throws', () => {
    throw new Error('connect ECONNREFUSED 10.0.0.7:5432');
  });
  app.get('/teapot', failWith({ message: 'short and stout', status: 418, expose: true }));
  app.get('/hidden', failWith({ message: 'row 42 is locked', status: 409, expose: false }));
  app.get('/draining', failWith({ message: 'shutting down', status: 503 }));
  app.use(notFound);
  app.use(errorHandler({ logger }));
  return { app, lines };
}

async function get(url: string) {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await json<ProblemDocument>(res) };
}

test('an unexpected error is a bare 500: logged with its stack, never shown', async () => {
  const { app, lines } = failingApp();
  const res = await withServer(app, (url) => get(`${url}/throws`));
  assert.equal(res.status, 500);
  assert.match(res.type, /^application\/problem\+json/);
  assert.deepEqual(res.body, { type: 'about:blank', title: 'Internal Server Error', status: 500 });
  const logged = lines.find((entry) => entry.level === 'error');
  assert.ok(logged, 'the error was not logged');
  assert.equal(logged.err?.message, 'connect ECONNREFUSED 10.0.0.7:5432');
  assert.ok(logged.err?.stack);
});

test('a client error keeps its message when it is marked safe to show', async () => {
  const { app, lines } = failingApp();
  const res = await withServer(app, (url) => get(`${url}/teapot`));
  assert.equal(res.status, 418);
  assert.equal(res.body.detail, 'short and stout');
  assert.equal(lines.length, 0, 'a client error was logged as a server failure');
});

test('a client error not marked safe to show keeps its status but not its message', async () => {
  const { app } = failingApp();
  const res = await withServer(app, (url) => get(`${url}/hidden`));
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { type: 'about:blank', title: 'Conflict', status: 409 });
});

test('a declared server error keeps its status, is logged, and shows nothing', async () => {
  const { app, lines } = failingApp();
  const res = await withServer(app, (url) => get(`${url}/draining`));
  assert.equal(res.status, 503);
  assert.equal(res.body.detail, undefined);
  assert.equal(lines.filter((entry) => entry.level === 'error').length, 1);
});

test('a path nothing answers is a 404 problem naming it', async () => {
  const { app } = failingApp();
  const res = await withServer(app, (url) => get(`${url}/missing`));
  assert.equal(res.status, 404);
  assert.equal(res.body.detail, 'No route for GET /missing');
});
