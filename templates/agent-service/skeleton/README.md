# ${{ values.name }}

${{ values.description }}

An **AI agent** scaffolded from the Adhar `agent-service` golden path. It runs in
its own **isolated AgentWorkload** and reaches models and tools only through the
platform's AI gateway, as its own identity.

```
git push → build → scan → sign → Argo CD → Argo Rollouts (canary) in ${{ values.name }}-dev
                                    └─ Kargo promotes dev → test → prod
```

## What the isolation gives you

| Boundary | Where it is declared |
|---|---|
| Namespace `${{ values.name }}-dev`, default-deny network | `deploy/agentworkload.yaml` (composed by the control plane) |
| Identity to the AI gateway | the pod's projected ServiceAccount token (`deploy/rollout.yaml`) |
| Models it may call: `${{ values.models }}` | `spec.parameters.models.allow` |
| Tool domains it may call: `${{ values.tools }}` | `spec.parameters.tools.allow` |
| Token budget: ${{ values.tokensPerHour }}/hour, alerted | `spec.parameters.budget` |

Anything not listed is a **403 from the gateway** — a prompt that talks the model
into calling a tool you did not grant fails at the data plane, not in your code.

## Endpoints

| Path | Purpose |
|---|---|
| `/` | Agent info |
| `/healthz` | Liveness/readiness probe |
| `/ask` | `POST {"prompt": "...", "model": "optional"}` — one reasoning step |

## Observability

Every LLM call is a `gen_ai.*` span and every tool call an `mcp.*` span, exported
over OTLP to the platform collector. Because the agent propagates W3C trace
context, the gateway's span and the provider latency sit in the **same trace**.
Open **Grafana → Adhar Agents** and pick `${{ values.name }}`.

## Local run

```sh
pip install -r requirements.txt
AI_GATEWAY_URL=http://localhost:8080 AI_GATEWAY_TOKEN_FILE=./token uvicorn agent:app --reload
```

## Extending

`agent.py` is deliberately one step. Turn it into a loop by reading `tool_calls`
from the model response and dispatching each through `call_tool()` — the gateway
federates every platform tool under one endpoint, with names prefixed by domain
(`cluster_list_pods`, `observability_query_metrics`, …).
