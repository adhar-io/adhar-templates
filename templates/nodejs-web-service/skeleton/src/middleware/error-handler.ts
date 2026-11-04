import type { ErrorRequestHandler, Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

import type { Logger } from '../lib/logger';
import type { ProblemDocument } from '../types';

// Every error leaves as an RFC 9457 problem document — {type, title, status,
// detail} with Content-Type application/problem+json — so a client parses
// one shape whatever went wrong.
function sendProblem(res: Response, status: number, detail?: string): void {
  const problem: ProblemDocument = {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Error',
    status,
    ...(detail ? { detail } : {}),
  };
  res.status(status).type('application/problem+json').json(problem);
}

// No route answered the request.
export function notFound(req: Request, res: Response): void {
  sendProblem(res, 404, `No route for ${req.method} ${req.path}`);
}

// What an error may say about itself: a status (http-errors and
// body-parser's errors set both spellings) and whether its message is safe to
// show a client.
interface ErrorDetails {
  readonly status?: unknown;
  readonly statusCode?: unknown;
  readonly expose?: unknown;
  readonly message?: unknown;
}

// Every error a handler throws or passes to next(err). A client error — a
// malformed JSON body (400), one too large (413) — keeps its message when the
// error marks it safe to show (`expose`). Anything else is logged with its
// stack and answered with a bare 500, so nothing internal — a query, a host
// name, a stack frame — reaches the client.
export function errorHandler({ logger }: { readonly logger: Logger }): ErrorRequestHandler {
  // Express recognises an error handler by its four parameters.
  return (err: unknown, req, res, next) => {
    const details: ErrorDetails = typeof err === 'object' && err !== null ? err : {};
    const declared = Number(details.status ?? details.statusCode);
    const status = Number.isInteger(declared) && declared >= 400 && declared <= 599 ? declared : 500;
    if (status >= 500) logger.error('request failed', { method: req.method, path: req.path, status, err });
    // The response has started: Express's own handler ends the connection.
    if (res.headersSent) {
      next(err);
      return;
    }
    const shown = status < 500 && details.expose === true && typeof details.message === 'string';
    sendProblem(res, status, shown ? details.message : undefined);
  };
}
