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

## Integration boundary and limitation

Focused unit/route tests use injected provider and storage boundaries; no live MinIO service was available in this worktree. A comprehensive `interactivePreview.integration.spec.ts` using an in-process S3-compatible fake and fake Vercel provider remains outstanding. It should cover the complete draft/upload/publish/event flow and observe the existing two-job gate under concurrent requests; this remediation did not add that file, so it is an explicit follow-up rather than a claim of complete end-to-end coverage.
