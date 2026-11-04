import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { FunctionConfig } from './config';
import { type Handler, invoke } from './handler';
import { log as defaultLog, type Log } from './log';

// Knative's contract with the function: HTTP on $PORT. GET /healthz answers
// without invoking the function; every other request — any path, any method,
// and every event a trigger delivers — invokes it, and what it returns is the
// JSON answer. No framework: the standard library is all a function needs.

export interface ServerOptions {
  // The function to invoke; src/handler.ts unless a test passes another.
  readonly handler?: Handler;
  // Bodies larger than this are refused with 413 rather than buffered.
  readonly maxBodyBytes?: number;
  readonly log?: Log;
}

export const MAX_BODY_BYTES = 1024 * 1024;

// An error whose status and message the caller may see.
class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // Stop keeping it: the rest of the body is read and dropped while the
        // 413 goes out.
        req.off('data', onData);
        reject(new HttpError(413, `request body larger than ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

export function createServer(
  config: FunctionConfig,
  { handler = invoke, maxBodyBytes = MAX_BODY_BYTES, log = defaultLog }: ServerOptions = {},
): Server {
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const path = new URL(req.url ?? '/', 'http://function.local').pathname;
      if (req.method === 'GET' && path === '/healthz') {
        send(res, 200, { ok: true, at: new Date().toISOString() });
        return;
      }
      const body = await readBody(req, maxBodyBytes);
      const ceType = req.headers['ce-type'];
      const invocation = {
        method: req.method ?? 'GET',
        path,
        headers: req.headers,
        event: typeof ceType === 'string' ? ceType : null,
        body,
      };
      send(res, 200, await handler(invocation, config));
    } catch (err) {
      // A refusal (413) is the caller's to read. Anything else is the
      // function's own failure: logged, and answered without its message,
      // which can name hosts, queries or credentials.
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      log(status >= 500 ? 'error' : 'warn', 'request failed', { method: req.method, url: req.url, status, error: message });
      if (!res.headersSent) send(res, status, { ok: false, error: status < 500 ? message : 'internal error' });
    }
  }

  return createHttpServer((req, res) => {
    void handle(req, res);
  });
}
