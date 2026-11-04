import type { Express } from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

// Serves `app` on an ephemeral port of 127.0.0.1 for the length of fn(baseUrl),
// then closes it, keep-alive connections included, so no test leaves a
// socket open behind it.
export async function withServer<T>(app: Express, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address() as AddressInfo;
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

// A response body parsed as JSON, typed as what the test expects it to be.
export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
