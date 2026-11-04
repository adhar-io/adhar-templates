import express, { type Express } from 'express';

import { errorHandler, notFound } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { createRouter } from './routes';
import type { AppDependencies } from './types';

// The HTTP application, without a socket: src/server.ts listens, and the
// tests drive it in-process. Everything it depends on is passed in (see
// AppDependencies in src/types/), so a test can hand it {% if values.withDatabase %}a fake database or {% endif %}a
// logger that records instead of printing.
export function createApp(deps: AppDependencies): Express {
  const app = express();
  // No "X-Powered-By: Express" on every response: it tells a scanner which
  // framework to try its exploits on.
  app.disable('x-powered-by');

  app.use(requestLogger({ logger: deps.logger }));
  app.use(express.json());
  app.use(createRouter(deps));

  // Last: what no route answered, then every error a route raised.
  app.use(notFound);
  app.use(errorHandler({ logger: deps.logger }));
  return app;
}
