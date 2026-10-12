# Architecture

```
  browser/caller ──▶ https://${{ values.hostname }} ──▶ Rollout (${{ values.name }}-dev)
                                                              │  projected SA token
                                                              ▼  (audience: agentgateway)
                                                   AI gateway  ── models by NAME
                                                              ├── Anthropic / OpenAI / vLLM
                                                              └── federated MCP tools
```

**Default deny.** The namespace's NetworkPolicy allows egress only to DNS, the
AI gateway and the telemetry collector. The gateway's authorization is Allow-only
and this agent's identity is admitted by exactly one rule: the one its
`AgentWorkload` composes from `models.allow` and `tools.allow`.

**Budget.** The gateway enforces a per-environment rate/token tier; the agent's
own `tokensPerHour` is measured from per-agent metrics and alerted on
(`AgentTokenBudgetExceeded`).
