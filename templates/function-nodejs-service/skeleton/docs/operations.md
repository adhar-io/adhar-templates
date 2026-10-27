# Operations

A runbook for `${{ values.name }}`. Everything here is read-only unless it says
otherwise. Replace `dev` with the environment you are looking at.

## Is it up?

| Question | Where to look |
| --- | --- |
| Is it serving? | `curl https://${{ values.hostname }}/healthz` |
| Is it deployed, and where? | `kubectl -n dev get function ${{ values.name }}` — URL, ready revision, conditions |
| Did the last promotion pass? | Kargo, project `adhar`, Stage `dev`: the freight's verification |
| What is it doing? | Grafana → Applications → `${{ values.name }}` |
| Why did it change? | the repository's history — every deploy is a commit |

## Reading the Function's conditions

| Condition | When it is not True |
| --- | --- |
| `ServiceReady` | Knative gave up on the newest revision: the image is missing or unsigned, the container crashes, or it never became ready |
| `EdgeReady` | the URL is not published: another namespace holds the host (`HostClaimed`), or the route is not accepted yet |
| `TriggersReady` | an event source is not ready, or the trigger is not implemented (`bucket`) |
| `Placement` | informational: where it runs, and any parameter the namespace overrode |

## It does not answer

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| The first request after a quiet spell is slow | a cold start: the function was scaled to zero | `minScale: 1` in that environment's overlay |
| `ServiceReady=False`, image error | the image is not signed — the build failed its scan gate — and admission refused it | fix the build; only signed digests are promoted |
| A revision pod in `CrashLoopBackOff` | the process exits on start | `kubectl -n dev logs -l serving.knative.dev/service=${{ values.name }} -c user-container` |
| 504 after `timeoutSeconds` | the request outlived the timeout | raise `timeoutSeconds` (at most 600) or make the work asynchronous |
| `EdgeReady=False` with `HostClaimed` | another namespace took the host first | set `spec.parameters.hostname` |

## Rolling back

Revert the commit, or promote an earlier freight in Kargo. The cluster follows
Git: a `kubectl edit` is undone by Argo CD within a minute.

## Changing configuration

`deploy/base/function.yaml` changes every environment; an environment's
`deploy/envs/<env>/kustomization.yaml` changes only that one. A change is a
commit like any other, promoted like any build. Credentials belong in a Secret,
never in Git.
