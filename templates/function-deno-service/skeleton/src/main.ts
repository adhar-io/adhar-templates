// Serves the function (src/handler.ts) on $PORT: 8080, where Knative sends its
// requests. `deno task dev` runs this file on Deno; the image runs it on
// Node.js 24 (`npm start`), where compat/serve-on-node.mjs provides Deno.serve
// and Deno.env.
import { handler } from "./handler.ts";

const port = Number(Deno.env.get("PORT") ?? "8080");

Deno.serve({
  port,
  onListen: ({ port }) =>
    console.log(JSON.stringify({
      level: "info",
      msg: "listening",
      function: Deno.env.get("FUNCTION_NAME") ?? ${{ values.name | dump }},
      port,
    })),
}, handler);
