const port = Number(Deno.env.get("PORT") ?? "8080");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

Deno.serve({ port }, (req) => {
  const url = new URL(req.url);
  const now = new Date().toISOString();
  if (req.method === "GET" && url.pathname === "/healthz") {
    return json({ ok: true, at: now });
  }
  return json({
    ok: true,
    function: Deno.env.get("FUNCTION_NAME") ?? "unknown",
    runtime: "custom",
    trigger: Deno.env.get("FUNCTION_TRIGGER") ?? "http",
    at: now,
  });
});
