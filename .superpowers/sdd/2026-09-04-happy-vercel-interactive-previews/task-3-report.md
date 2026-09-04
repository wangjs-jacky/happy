# Task 3 lifecycle remediation report

## Delivered lifecycle behavior

- The cleanup loop now runs once per minute. A `publishing` row whose 15-minute lease has elapsed is atomically converted to a `failed` tombstone with `PUBLISH_LEASE_EXPIRED`; its Task 2 `vercelDeploymentId` is intentionally retained.
- Cleanup selection and row claiming are replica-safe `updateMany` compare-and-set operations. It includes expired draft/failed/ready rows and immediately retryable `deleting` tombstones.
- Cleanup deletes a recorded Vercel deployment before its OSS prefix, and only marks the row `expired` after both operations succeed. Missing credentials, provider errors, and OSS errors retain `status=deleting`, the deployment ID, and a cleared claim for retry.
- Vercel deployment deletion accepts provider 404 as an idempotent success, avoiding a permanent retry loop after a successful earlier delete whose response was lost.
- Explicit preview deletion is account-scoped and idempotent: it creates a `deleting` tombstone with URL removed rather than deleting database evidence. It is therefore safe when credentials are unavailable or provider deletion fails.
- Duplicate publication returns the current `publishing` event; a ready publication continues to be returned idempotently. The existing module-level two-slot gate and sequential per-file upload loop were retained.
- Vercel disconnect asks the preview service to enumerate only active rows for the authenticated account, best-effort delete provider deployments and staging, retain failed rows as `deleting` with `VERCEL_DEPLOYMENT_CLEANUP_PENDING`, then remove credentials. The endpoint returns only that fixed warning code, never a provider token or response detail.

## Red/green evidence

| Behavior | Red evidence | Green evidence |
| --- | --- | --- |
| Cleanup retry tombstone | `previewCleanup.spec.ts` failed because `retainForRetry` was never called after provider/OSS failures | 4 cleanup tests pass, including retained provider ID/staging failure and stale lease CAS claim |
| Explicit idempotent deletion | `previewService.spec.ts` failed because delete directly removed state and unknown IDs threw | 9 preview-service tests pass; delete now leaves a retryable tombstone |
| Duplicate in-flight publish | test failed with `Preview assets are incomplete` for an in-flight row | test now receives the current `publishing` event |
| Provider delete idempotency | `vercelClient.spec.ts` rejected a 404 `not_found` response | 30 Vercel-client tests pass with 404 treated as successful removal |
| Disconnect warning | connection route test returned `{ success: true }` without the cleanup warning | 8 connection-route tests pass with a fixed safe warning response |

## Files changed

- `packages/happy-server/sources/app/previews/previewCleanup.ts`
- `packages/happy-server/sources/app/previews/previewService.ts`
- `packages/happy-server/sources/app/previews/vercelClient.ts`
- `packages/happy-server/sources/app/api/routes/vercelConnectRoutes.ts`
- Associated focused Vitest specifications.

## Verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts

Test Files  5 passed (5)
Tests       55 passed (55)

pnpm --dir packages/happy-server run typecheck
exit 0

PGLITE_DIR=/tmp/happy-preview-pglite-smoke-1788510210 \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 40 migration(s), including 20260904090000_add_interactive_previews

git diff --check
exit 0
```

Final completion pass after integration additions:

```text
interactivePreview.integration.spec.ts: 4 passed (4)
all six focused Task 3 files: 61 passed (61)
pnpm --dir packages/happy-server run typecheck: exit 0
fresh PGlite smoke: Applied 41 migration(s)
git diff --check: exit 0
```

## Integration boundary and limitation

`interactivePreview.integration.spec.ts` now starts a real local Vercel HTTP server and passes its origin into the production Vercel client. It uses Fastify injection, a persisted test database boundary, and the production preview service/storage to cover authenticated/session-owned draft creation, direct private-stage upload/completion, typed ready response, sequential Vercel uploads, Preview readiness, staging removal, cross-account list/publish denial, expiry deletion, global two-job publication gating, duplicate in-flight publication, stale-publishing recovery, and deletion tombstone retry-deadline claims. MinIO is not provisioned by the local test runner, so S3 is an in-process S3-compatible client boundary rather than a wire-level S3 server.

Durable cleanup retries now persist `cleanupRetryCount` and `cleanupNextAttemptAt` in migration `20260904100000_add_interactive_preview_cleanup_retries`. Failures use capped exponential delays (one minute, doubling to one hour); cleanup claims only rows whose retry deadline is due.

Vercel client requests retry transient 429 and 5xx responses up to two times, honoring `Retry-After` (capped at ten seconds) or a bounded exponential delay. The deterministic client test proves the 429 path.
