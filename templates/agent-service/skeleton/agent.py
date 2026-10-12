"""${{ values.name }} — an Adhar agent.

Everything an agent needs from the platform arrives as three things:

  AI_GATEWAY_URL         one OpenAI-compatible URL for every model AND every
                         tool (MCP). Pick a model by NAME; keys, routing,
                         guardrails and budgets live in the gateway.
  AI_GATEWAY_TOKEN_FILE  the agent's identity — a projected ServiceAccount
                         token, rotated by kubelet. Read it per request.
  OTEL_*                 where to send traces/metrics. Every LLM call and every
                         tool call below becomes a span with gen_ai.* attributes.

The gateway admits exactly the models and tool domains listed in
deploy/agentworkload.yaml — nothing else — so a prompt-injected "call the
provision tool" is a 403 at the gateway, not an incident.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx
from fastapi import FastAPI
from opentelemetry import metrics, trace
from pydantic import BaseModel

GATEWAY = os.environ.get("AI_GATEWAY_URL", "http://adhar-ai-gateway.adhar-system.svc.cluster.local:8080")
TOKEN_FILE = os.environ.get("AI_GATEWAY_TOKEN_FILE", "/var/run/agent/token")
DEFAULT_MODEL = os.environ.get("AGENT_DEFAULT_MODEL", "claude-opus-4-5-20251101")
SYSTEM_PROMPT = os.environ.get("AGENT_SYSTEM_PROMPT", "You are a careful platform assistant.")
AGENT = os.environ.get("ADHAR_AGENT", "${{ values.name }}")
ENVIRONMENT = os.environ.get("ADHAR_ENVIRONMENT", "dev")

tracer = trace.get_tracer("adhar.agent")
meter = metrics.get_meter("adhar.agent")
# The SDK pushes these over OTLP; Alloy converts them to Prometheus series with
# the resource attributes (adhar.agent, deployment.environment) as labels.
llm_tokens = meter.create_counter("agent_llm_tokens", unit="{token}", description="Tokens by type and model")
llm_calls = meter.create_counter("agent_llm_calls", description="LLM calls by model and outcome")
tool_calls = meter.create_counter("agent_tool_calls", description="MCP tool calls by tool and outcome")
step_latency = meter.create_histogram("agent_step_duration_seconds", unit="s", description="End-to-end agent step time")

app = FastAPI(title=AGENT)


def _token() -> str:
    # Read on every request: kubelet rotates the projected token in place.
    with open(TOKEN_FILE, encoding="utf-8") as f:
        return f.read().strip()


def _headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"}


class Ask(BaseModel):
    prompt: str
    model: str | None = None


def chat(messages: list[dict[str, Any]], model: str) -> dict[str, Any]:
    """One LLM call through the gateway, as a gen_ai span."""
    with tracer.start_as_current_span("llm.chat") as span:
        span.set_attribute("gen_ai.system", "adhar-gateway")
        span.set_attribute("gen_ai.request.model", model)
        span.set_attribute("adhar.agent", AGENT)
        span.set_attribute("adhar.environment", ENVIRONMENT)
        started = time.perf_counter()
        try:
            r = httpx.post(f"{GATEWAY}/v1/chat/completions", headers=_headers(),
                           json={"model": model, "messages": messages, "max_tokens": 1024}, timeout=120)
            span.set_attribute("http.response.status_code", r.status_code)
            if r.status_code != 200:
                llm_calls.add(1, {"model": model, "outcome": f"http_{r.status_code}"})
                span.set_attribute("error", True)
                # 403 = the gateway refused this model for this agent's identity:
                # the allow-list in deploy/agentworkload.yaml does not include it.
                raise RuntimeError(f"gateway {r.status_code}: {r.text[:300]}")
            body = r.json()
            usage = body.get("usage") or {}
            for kind, key in (("input", "prompt_tokens"), ("output", "completion_tokens")):
                n = int(usage.get(key) or 0)
                span.set_attribute(f"gen_ai.usage.{kind}_tokens", n)
                llm_tokens.add(n, {"model": model, "gen_ai.token.type": kind})
            llm_calls.add(1, {"model": model, "outcome": "ok"})
            return body
        finally:
            span.set_attribute("duration_s", time.perf_counter() - started)


def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    """One MCP tools/call through the gateway's federated endpoint."""
    with tracer.start_as_current_span("tool.call") as span:
        span.set_attribute("mcp.tool.name", name)
        span.set_attribute("adhar.agent", AGENT)
        payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                   "params": {"name": name, "arguments": arguments}}
        r = httpx.post(f"{GATEWAY}/mcp", headers=_headers(), json=payload, timeout=60)
        span.set_attribute("http.response.status_code", r.status_code)
        outcome = "ok" if r.status_code == 200 else f"http_{r.status_code}"
        tool_calls.add(1, {"tool": name, "outcome": outcome})
        if r.status_code != 200:
            span.set_attribute("error", True)
            raise RuntimeError(f"tool {name}: gateway {r.status_code}: {r.text[:300]}")
        return r.json()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "agent": AGENT, "environment": ENVIRONMENT}


@app.get("/")
def index() -> dict[str, Any]:
    return {"agent": AGENT, "environment": ENVIRONMENT, "model": DEFAULT_MODEL, "gateway": GATEWAY}


@app.post("/ask")
def ask(req: Ask) -> dict[str, Any]:
    """One agent step: a single reasoning call. Extend into a loop that reads
    tool_calls from the model response and dispatches them via call_tool()."""
    model = req.model or DEFAULT_MODEL
    with tracer.start_as_current_span("agent.step") as span:
        span.set_attribute("adhar.agent", AGENT)
        started = time.perf_counter()
        try:
            body = chat([{"role": "system", "content": SYSTEM_PROMPT},
                         {"role": "user", "content": req.prompt}], model)
            text = (body.get("choices") or [{}])[0].get("message", {}).get("content", "")
            return {"model": body.get("model", model), "answer": text, "usage": body.get("usage")}
        finally:
            step_latency.record(time.perf_counter() - started, {"model": model})


if __name__ == "__main__":  # local run: uvicorn agent:app --reload
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "${{ values.port }}")))
