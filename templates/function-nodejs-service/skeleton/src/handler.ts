import type { IncomingHttpHeaders } from 'node:http';

import type { FunctionConfig } from './config';

// ${{ values.name }}: the function. Replace the body of `invoke` with what yours
// does. src/http.ts hands it every request and every event — a schedule, a
// Broker and a topic all deliver as HTTP POSTs — and answers with what it
// returns, as JSON. An error it throws is answered with a 500 and logged; its
// message is not shown to the caller.

// One request or event, as the function sees it.
export interface Invocation {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  // The CloudEvent type (the ce-type header) when an event invoked the
  // function, else null.
  readonly event: string | null;
  // The request body as it arrived (at most 1 MiB).
  readonly body: Buffer;
}

// What the function answers: the Invocation schema in api/openapi.yaml.
// Change the two together.
export interface InvocationResult {
  readonly ok: true;
  readonly function: string;
  readonly runtime: string;
  readonly trigger: string;
  readonly method: string;
  readonly path: string;
  readonly event: string | null;
  // The size of the body, in bytes.
  readonly received: number;
  readonly at: string;
}

// A function: synchronous, or `async` when it has something to wait for.
export type Handler = (invocation: Invocation, fn: FunctionConfig) => InvocationResult | Promise<InvocationResult>;

export const invoke: Handler = (invocation, fn) => ({
  ok: true,
  function: fn.name,
  runtime: fn.runtime,
  trigger: fn.trigger,
  method: invocation.method,
  path: invocation.path,
  event: invocation.event,
  received: invocation.body.length,
  at: new Date().toISOString(),
});
