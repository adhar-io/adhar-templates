# ${{ values.name }}

${{ values.description }}

An AI agent on the Adhar `agent-service` golden path. Its boundary — namespace,
network, identity, allowed models and tools, budget — is one object:
`deploy/agentworkload.yaml`. Its code is `agent.py`.

Your agent is at **https://${{ values.hostname }}** once the first rollout
completes; its repository is `${{ values.gitOwner }}/${{ values.repoName }}`.
