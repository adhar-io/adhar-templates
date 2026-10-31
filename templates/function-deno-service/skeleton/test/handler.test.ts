// The function's tests. `npm test` runs them on Node.js 24, the runtime the
// image ships (through compat/serve-on-node.mjs), and app-ci runs exactly that
// on every push; `deno task test` runs the same file on Deno.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handler } from "../src/handler.ts";

const base = "http://function.local";
const cloudEvent = {
  "content-type": "application/json",
  "ce-type": "com.example.ping",
  "ce-source": "test",
  "ce-id": "1",
  "ce-specversion": "1.0",
};

test("GET /healthz answers ok", async () => {
  const res = await handler(new Request(`${base}/healthz`));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("GET / invokes the function", async () => {
  const res = await handler(new Request(`${base}/`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.method, "GET");
  assert.equal(body.path, "/");
  assert.equal(body.event, null);
});

test("a CloudEvent POSTed to / is handled", async () => {
  const res = await handler(
    new Request(`${base}/`, {
      method: "POST",
      headers: cloudEvent,
      body: JSON.stringify({ hello: "world" }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.event, "com.example.ping");
  assert.equal(body.received, 17);
});

test("a body over 1 MiB is refused", async () => {
  const res = await handler(
    new Request(`${base}/`, { method: "POST", body: new Uint8Array(1024 * 1024 + 1) }),
  );
  assert.equal(res.status, 413);
  await res.body?.cancel();
});

// Over a real socket through Deno.serve: on Node that is compat/serve-on-node.mjs,
// the server the image runs.
test("Deno.serve answers over HTTP", async () => {
  const listening = Promise.withResolvers<number>();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: ({ port }) => listening.resolve(port),
  }, handler);
  try {
    const port = await listening.promise;
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const res = await fetch(`http://127.0.0.1:${port}/orders?id=7`, {
      method: "POST",
      headers: cloudEvent,
      body: JSON.stringify({ hello: "world" }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    const body = await res.json();
    assert.equal(body.path, "/orders");
    assert.equal(body.event, "com.example.ping");
    assert.equal(body.received, 17);
  } finally {
    await server.shutdown();
  }
});
