// ${{ values.name }}: an HTTP function on Adhar's Function API (Knative).
//
// Knative starts the function on demand, sends it requests on $PORT (8080) and
// scales it to zero when no request has arrived for a while. Events from the
// function's trigger arrive as HTTP POSTs too: a CloudEvent in binary mode
// (ce-* headers) from a schedule or a Broker, or a Dapr topic delivery.
//
// Web-standard Request → Response only, so the same code runs on Deno and, in
// the image, on Node.js 24 through compat/serve-on-node.mjs.

// Requests larger than this are refused rather than buffered.
const MAX_BODY = 1024 * 1024;

type Invocation = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// The function. Replace the body of `invoke` with what yours does; it may be
// async.
function invoke(req: Request, body: Uint8Array): Invocation | Promise<Invocation> {
  return {
    ok: true,
    function: Deno.env.get("FUNCTION_NAME") ?? ${{ values.name | dump }},
    runtime: Deno.env.get("FUNCTION_RUNTIME") ?? "local",
    trigger: Deno.env.get("FUNCTION_TRIGGER") ?? "http",
    method: req.method,
    path: new URL(req.url).pathname,
    event: req.headers.get("ce-type"),
    received: body.byteLength,
    at: new Date().toISOString(),
  };
}

// The request body, or null once it is larger than MAX_BODY.
async function readBody(req: Request): Promise<Uint8Array | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  if (!req.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "GET" && new URL(req.url).pathname === "/healthz") {
    return json({ ok: true, at: new Date().toISOString() });
  }
  try {
    const body = await readBody(req);
    if (body === null) return json({ ok: false, error: "request body too large" }, 413);
    return json(await invoke(req, body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ level: "error", msg: message }));
    return json({ ok: false, error: message }, 500);
  }
}
