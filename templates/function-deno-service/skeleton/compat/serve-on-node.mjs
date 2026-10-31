// Deno.serve and Deno.env on Node.js: the two Deno APIs this function uses, so
// the source in src/ runs unchanged in the image.
//
// Why it exists: the platform builds every image with Cloud Native Buildpacks,
// and paketo's builder has no Deno buildpack. The image therefore runs Node.js
// 24 (BP_NODE_VERSION in project.toml), which strips the TypeScript types
// itself, with this module preloaded in front of the source:
//
//   node --import ./compat/serve-on-node.mjs src/main.ts   # npm start: the image
//   node --import ./compat/serve-on-node.mjs --test        # npm test: app-ci
//
// On Deno it does nothing; the real Deno namespace is already there. A Deno API
// this file does not provide fails on Node with a TypeError naming it ("Deno.x
// is not a function"): add it here, or keep the source to Web-standard APIs.
import { createServer } from "node:http";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const env = Object.freeze({
  get: (key) => process.env[key],
  set: (key, value) => {
    process.env[key] = String(value);
  },
  delete: (key) => {
    delete process.env[key];
  },
  has: (key) => Object.hasOwn(process.env, key),
  toObject: () => ({ ...process.env }),
});

// Deno.serve(handler) | Deno.serve(options, handler) | Deno.serve({ handler, ...options }),
// with Deno's defaults (0.0.0.0:8000) and its HttpServer surface.
function serve(optionsOrHandler, maybeHandler) {
  const options = typeof optionsOrHandler === "function" ? {} : { ...optionsOrHandler };
  const handler = typeof optionsOrHandler === "function"
    ? optionsOrHandler
    : maybeHandler ?? options.handler;
  if (typeof handler !== "function") {
    throw new TypeError("Deno.serve: a handler function is required");
  }
  const hostname = options.hostname ?? "0.0.0.0";
  const onError = options.onError ?? ((error) => {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  });

  const server = createServer((req, res) => {
    respond(req, res, handler, onError).catch((error) => {
      console.error(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const finished = new Promise((resolve) => server.once("close", resolve));
  const shutdown = () => {
    server.close();
    server.closeIdleConnections();
    return finished;
  };
  options.signal?.addEventListener("abort", shutdown, { once: true });
  server.listen(options.port ?? 8000, hostname, () => {
    const local = { transport: "tcp", hostname, port: server.address().port };
    if (options.onListen) options.onListen(local);
    else console.log(`Listening on http://${hostname}:${local.port}/`);
  });

  return {
    finished,
    shutdown,
    get addr() {
      const address = server.address();
      return address && { transport: "tcp", hostname: address.address, port: address.port };
    },
    ref: () => server.ref(),
    unref: () => server.unref(),
    [Symbol.asyncDispose]: shutdown,
  };
}

// One request: Node's IncomingMessage → a Web Request → the handler → its Web
// Response back onto Node's ServerResponse, streamed.
async function respond(req, res, handler, onError) {
  let url;
  try {
    url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  }
  // The handler's request.signal aborts when the client goes away.
  const aborted = new AbortController();
  res.once("close", () => {
    if (!res.writableFinished) aborted.abort();
  });
  const withBody = req.method !== "GET" && req.method !== "HEAD";
  const request = new Request(url, {
    method: req.method,
    headers,
    signal: aborted.signal,
    ...(withBody ? { body: Readable.toWeb(req), duplex: "half" } : {}),
  });
  const info = {
    remoteAddr: {
      transport: "tcp",
      hostname: req.socket.remoteAddress ?? "",
      port: req.socket.remotePort ?? 0,
    },
  };

  let response;
  try {
    response = await handler(request, info);
  } catch (error) {
    response = await onError(error);
  }
  if (!(response instanceof Response)) {
    response = await onError(new TypeError("the handler did not return a Response"));
  }

  const head = [];
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") head.push(name, value);
  }
  for (const cookie of response.headers.getSetCookie()) head.push("set-cookie", cookie);
  if (response.statusText) res.writeHead(response.status, response.statusText, head);
  else res.writeHead(response.status, head);

  if (response.body === null || req.method === "HEAD") {
    await response.body?.cancel();
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (error) {
    // A client that went away mid-response is not an error of the function.
    if (!aborted.signal.aborted) console.error(error);
    res.destroy();
  }
}

if (!("Deno" in globalThis)) {
  Object.defineProperty(globalThis, "Deno", {
    value: Object.freeze({ env, serve }),
    enumerable: false,
    configurable: true,
    writable: false,
  });
}
