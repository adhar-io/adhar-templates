// The shape of a srvx middleware (https://srvx.h3.dev), as server.ts mounts
// them: answer the request, or pass it on to the rest of the chain with next().
// Declared here rather than taken from srvx so the middlewares — and their
// unit tests, which call them with plain Requests — do not depend on it.

/** The rest of the chain: the next middleware, finally the TanStack Start app. */
export type Next = () => Response | Promise<Response>

export type Middleware = (request: Request, next: Next) => Response | Promise<Response>

/** Environment variables, read on every request so a Secret mounted after start-up is picked up. */
export type Env = Record<string, string | undefined>
