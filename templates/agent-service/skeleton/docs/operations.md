# Operations

| Question | Where |
|---|---|
| What is it spending? | Grafana → **Adhar Agents** → `${{ values.name }}` |
| Why did a step take 40s? | Tempo: search `adhar.agent=${{ values.name }}`; the trace spans agent → gateway → provider |
| It got a 403 | The model or tool is not in `deploy/agentworkload.yaml`. Widen the list in a reviewed commit. |
| It got a 429 | The environment tier's rate limit. Check `AgentRateLimited`; a looping agent is the usual cause. |
| Promote to test/prod | `kargo promote --project ${{ values.name }} --stage test --freight-alias <alias>` (prod waits for a person) |
