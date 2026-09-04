# Task 2 remediation report: Vercel provider/client

## Scope completed

This remediation closes the Task 2 provider/client gaps without changing Task 3 lifecycle recovery, cleanup scheduling, or disconnect cleanup behavior.

- A publish now resolves a dedicated Vercel project before deployment. It first creates `happy-previews`; an existing project causes a `409` conflict rather than adoption, so Happy creates a configuration-ID-derived collision-safe name instead. New project responses must echo the requested name.
- The encrypted account-scoped Vercel credential already supports `projectId`; the preview service now persists the resolved ID there and validates/reuses it through the Vercel API on later publishes. A project ID must match the fetched project and have the Happy preview name prefix.
- Deployments continue to request `target: null`. The Vercel client polls deployment status until `READY`, rejects `ERROR`/`CANCELED`, and has a 120-second bounded readiness timeout. Individual provider requests retain their 30-second abort timeout.
- Happy uploads its own `vercel.json` and includes its SHA in the Vercel file manifest. It applies `X-Robots-Tag: noindex, nofollow, noarchive`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer` to all paths. An Agent-supplied `vercel.json` is rejected before any provider upload.

Token storage, per-account credential paths, authenticated connection routes, and account isolation were left intact. The existing credential-store specs still cover encrypted provider-scoped persistence and strict parsing.

## Files changed

- `packages/happy-server/sources/app/previews/vercelClient.ts`
- `packages/happy-server/sources/app/previews/vercelClient.spec.ts`
- `packages/happy-server/sources/app/previews/previewService.ts`
- `packages/happy-server/sources/app/previews/previewService.spec.ts`
- `.superpowers/sdd/2026-09-04-happy-vercel-interactive-previews/task-2-report.md`

## TDD evidence

Each new behavior began with a focused failing test:

| Behavior | Red result | Green result |
| --- | --- | --- |
| Collision-safe project creation and persisted project validation | `ensurePreviewProject is not a function` (2 client tests) | `vercelClient.spec.ts`: 7/7 passing after implementation |
| Persist resolved project ID in encrypted credential | expected credential `set` call, received 0 calls | `previewService.spec.ts`: 3/3 passing after implementation and fixture updates |
| Happy-owned no-index configuration and SHA manifest | expected config upload defined, received `undefined` | `previewService.spec.ts`: 4/4 passing after implementation |
| Reject Agent-provided `vercel.json` | expected `/vercel.json/`, received integrity mismatch | `previewService.spec.ts`: 5/5 passing after guard |
| Readiness polling, terminal provider failures, and timeout | returned `BUILDING` URL / resolved `QUEUED` and `BUILDING` deployments | `vercelClient.spec.ts`: 10/10 passing after polling implementation |

The first attempted focused command used an incorrect workspace filter (`pnpm --filter happy-server ...`) and failed before running tests because the package is named `happy-server-self-host`. It was corrected to `pnpm --dir packages/happy-server exec vitest run ...`; the subsequent red runs above exercised the intended assertions.

## Verification output

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts

Test Files  4 passed (4)
Tests       23 passed (23)
```

```text
pnpm --dir packages/happy-server run typecheck
> tsc --noEmit
exit 0
```

`git diff --check` also exited cleanly. The route spec intentionally logs one sanitized OAuth exchange error while testing its failure redirect; it does not expose a token or cause a test failure.

## Deliberately left to Task 3

- Restart recovery for in-flight publications.
- Background deployment/staging cleanup, retries, and expiry deletion.
- Disconnect-time deployment cleanup and provider revocation handling.
- Any lifecycle schema or scheduler changes beyond storing/reusing the already-supported encrypted `projectId` field.
