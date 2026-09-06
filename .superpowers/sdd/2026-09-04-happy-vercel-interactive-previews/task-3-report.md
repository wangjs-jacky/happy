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

## Cluster G review-fix follow-up: durable Vercel replacement ownership

- `Account` now carries a durable Vercel connection epoch, replacement state,
  nonce, and start time. Reconnect atomically increments and fences the epoch
  before an out-of-transaction encrypted credential write; only the callback
  holding that nonce may finalize the state. A stale callback cannot overwrite
  a newer epoch, and an abandoned replacement lease is safely recovered.
- Draft creation and publication are blocked while a replacement is in progress.
  Publication additionally requires the draft/failed row's `expiresAt` to be
  strictly later than the captured claim time, so an expired preview cannot
  publish if cleanup has not yet run.
- A scope-changing reconnect drains all old-scope nonterminal/deleting rows
  using the old encrypted credential before credentials are replaced. It
  reconciles unresolved creation attempts, checkpoints provider deletion before
  staging deletion, and preserves old credentials plus deleting tombstones with
  `VERCEL_CONNECTION_REPLACEMENT_CLEANUP_PENDING` when cleanup is ambiguous or
  fails. Scope comparison normalizes `null` and `undefined` as the personal
  scope; old deployments are never deleted with a new credential.

### Cluster G red/green evidence

| Behavior | Red evidence | Green evidence |
| --- | --- | --- |
| Expiry claim fence | an expired `draft` was claimed and published when the scheduler had not run | a controlled clock makes the publication CAS reject `expiresAt <= claimTime` before credential/provider access |
| Replacement cleanup failure | scope-changing reconnect completed after an old deployment deletion failure | reconnect returns the fixed pending-cleanup error, retains the old encrypted credential, and keeps the tombstone deleting |
| Callback reordering | an older callback could complete after a newer callback and replace its credential | an encrypted-store write barrier leaves the newer epoch/credential active and rejects the stale finalizer |
| Publication during credential gap | a draft could claim and publish while replacement storage was pending | replacement state rejects publication (and draft creation) without reading credentials or calling Vercel |
| Old-scope drain | ready/deleting/unresolved old-scope deployments did not share a persisted end-to-end cleanup case | persisted PGlite/S3/Vercel integration drains all three via the old team credential, then activates the new scope |

### Cluster G verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts

Test Files  9 passed (9)
Tests       121 passed (121)

pnpm --dir packages/happy-wire exec vitest run src/interactivePreview.test.ts
Test Files  1 passed (1)
Tests       14 passed (14)

pnpm --dir packages/happy-cli exec vitest run src/previews/previewApi.test.ts --config /dev/null
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-wire run typecheck
pnpm --dir packages/happy-cli run typecheck
pnpm --dir packages/happy-server run typecheck
exit 0

pnpm --dir packages/happy-server exec prisma generate
PGLITE_DIR=/tmp/happy-task3-cluster-g.<random> \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 45 migration(s), including
20260904140000_durable_vercel_connection_replacement

git diff --check
exit 0
```

## Cluster H quality-review follow-up: disconnect fencing, recovery, and proven scope

- Disconnect is now a durable connection-state transition: it advances the
  account epoch, installs its own nonce/replacement identity, and atomically
  tombstones all nonterminal previews. It only finalizes to `disconnected` if
  it still owns that identity. The encrypted credential record carries the
  same epoch and nonce; conditional delete can remove only its observed
  version, so a delayed disconnect cannot erase a replacement credential.
- Reconnect handles same-scope work explicitly. Existing drafts, uploads,
  failed drafts, and ready rows advance to the new connection generation and
  stay publishable; in-flight provider publications become deleting
  reconciliation tombstones. Long old-scope drains renew their durable lease
  before and after each external operation, so a live operation is not stolen
  merely because fifteen minutes elapsed.
- Stale replacement recovery is fail-closed. It advances to a fresh durable
  generation/nonce, removes only the stale credential version, and leaves the
  account `disconnected` for a deliberate reconnect rather than restoring
  `active` without a proven credential. Credential storage remains outside the
  relational transaction, so its encrypted record is a versioned CAS phase;
  final account activation is a nonce/state CAS and a losing finalizer deletes
  only its exact credential version.
- Draft creation now reads and locks the active account epoch, validates the
  session, and inserts/reuses the draft in one database transaction. This
  prevents a reconnect from passing the pre-read and missing the new draft.
- `InteractivePreview.vercelScopeKnown` distinguishes a known personal scope
  from a legacy unknown `vercelTeamId = null`. Migration backfill marks legacy
  null-team provider rows unknown. Before deletion, recovery and cleanup use
  an unscoped deployment lookup to prove the current credential owns that
  scope; unproven rows remain tombstones, while provider 404 is checkpointed
  as a successful provider deletion. No token or provider response is stored
  or logged.

### Cluster H red/green evidence

| Behavior | Red evidence | Green evidence |
| --- | --- | --- |
| Disconnect/reconnect ordering | a delayed disconnect could use unconditional delete after a reconnect wrote a new credential | controlled barriers cover reconnect-then-disconnect and disconnect-then-reconnect; only the winning epoch/nonce may retain a credential |
| Same-scope reconnect | same-scope drafts retained an old connection generation and a publisher could remain stranded | draft generation advances and remains publishable; delayed provider creation is fenced and becomes a deleting reconciliation tombstone |
| Abandoned replacement | stale recovery restored `active` despite no proven replacement credential | recovery advances generation, fences the old finalizer, conditionally removes its record, and requires reconnect from `disconnected` |
| Draft/reconnect race | draft account check and insert were separable | a transaction barrier shows the account fence remains held until the new draft is inserted |
| Legacy null-team provider row | a null `vercelTeamId` was treated as personal and could be deleted with an unproven credential | migration test backfills unknown; cleanup proves matching scope, retains mismatch, and treats unscoped 404 as success |

### Cluster H verification

```text
pnpm --dir packages/happy-server exec vitest run \\
  sources/app/previews/interactivePreview.integration.spec.ts --reporter=dot --silent

Test Files  1 passed (1)
Tests       16 passed (16)

pnpm --dir packages/happy-server exec vitest run \\
  sources/app/previews/previewStorage.spec.ts \\
  sources/app/previews/previewService.spec.ts \\
  sources/app/previews/previewCleanup.spec.ts \\
  sources/app/previews/vercelCredentialStore.spec.ts \\
  sources/app/previews/vercelClient.spec.ts \\
  sources/app/previews/vercelScopeMigration.spec.ts \\
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \\
  sources/app/api/routes/vercelConnectRoutes.spec.ts \\
  sources/app/session/sessionDelete.spec.ts --reporter=dot --silent

Test Files  9 passed (9)
Tests       115 passed (115)

pnpm --dir packages/happy-wire exec vitest run src/interactivePreview.test.ts
Test Files  1 passed (1)
Tests       14 passed (14)

pnpm --dir packages/happy-cli exec vitest run src/previews/previewApi.test.ts --config /dev/null
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-server exec prisma generate
pnpm --dir packages/happy-server run typecheck
pnpm --dir packages/happy-wire run typecheck
pnpm --dir packages/happy-cli run typecheck
exit 0

PGLITE_DIR=/tmp/happy-task3-cluster-h.<random> \\
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 46 migration(s), including
20260904150000_harden_vercel_connection_fences

git diff --check
exit 0
```

## Cluster F quality-review follow-up: Vercel digests, ownership, reconnect fences, and legacy staging

### Delivered corrections

1. The preview manifest remains a SHA-256 integrity contract: staged bytes are
   checked against the persisted 64-hex `sha256` before publication. The
   Vercel Files API is now given a separately computed SHA-1 of those verified
   bytes (and of Happy's generated `vercel.json`); the Vercel client rejects
   any upload or deployment file reference that is not exactly 40 lowercase
   hexadecimal characters. The production-client HTTP fixture independently
   verifies the SHA-1/body match and that every deployment reference names an
   uploaded SHA-1 file.
2. Publication and stale recovery now have exclusive CAS ownership.
   Publisher CAS predicates include `cleanupClaimedAt: null`. A late publisher
   only compensates a created deployment after atomically proving the row is
   its unclaimed `deleting` tombstone; recovery only marks an obsolete
   deployment under its own deletion claim and never deletes a deployment that
   has become ready. The persisted delayed-create race proves recovery can
   bind and ready the matching deployment while the late publisher makes zero
   delete calls.
3. OAuth callback delegates credential replacement to a single
   `reconnectVercel` service operation. Its database transaction advances
   `Account.vercelConnectionEpoch` and fences active previews to `deleting`
   before the new token reaches the encrypted credential store. A publisher
   validates that epoch before provider create, in `onCreated`, and before the
   ready CAS. The persisted account/team race proves an old-team publisher
   cannot mark ready and compensates with its captured old-team client; the
   new team never receives a false-success 404 cleanup. `vercelTeamId` is
   stored as lifecycle scope metadata only; provider access tokens remain only
   in encrypted credential storage.
4. Upload descriptors are reissued only for an unexpired, unclaimed `draft`.
   Expired, `deleting`, and cleanup-claimed rows return the same scoped
   not-found error and never mint new descriptors.
5. `PREVIEW_ASSET_ID_MAX_LENGTH` and the asset-ID Zod schema are shared by
   happy-wire, storage, and routes. The selected contract bound is 96 because
   Fastify's default 100-character parameter limit must leave room for the
   route structure; 96 is accepted and 97 is rejected consistently at the
   wire and HTTP boundaries.
6. Existing persisted storage keys are deliberately not rewritten in a DB
   migration: object-store renames are non-transactional and could strand a
   verified object. New previews use the hardened account/generation key;
   read/assert/upload accept a narrowly parsed legacy
   `private/interactive-previews/<previewId>/<assetId>` key. Cleanup lists
   only the new exact prefix and removes legacy objects only when their exact
   persisted key belongs to that preview—never a broad legacy prefix. The
   persisted legacy test completes and publishes a pre-hardening row, removes
   its exact legacy object, and proves a sibling object survives.

### Cluster F red/green evidence

| Regression initially exposed | Green regression coverage |
| --- | --- |
| SHA-256 values were sent to Vercel, whose file API requires SHA-1. | Client and service tests reject 64-hex Vercel refs, assert SHA-1 uploads/references, and the production HTTP fake verifies digest/body/ref consistency. |
| A delayed publisher could compensate a deployment that recovery was about to make ready. | Persisted delayed publisher/recovery race ends `ready` with zero provider deletes. |
| OAuth reconnect could replace credential scope while old work still held a provider client. | Transaction ordering unit test plus persisted old-team reconnect race fence the publisher and prove old-scope compensation. |
| Any matching historical draft reissued fresh upload URLs. | Expired, deleting, and cleanup-claimed descriptor reissue cases all reject. |
| Asset-ID bounds drifted between wire (128), storage (96), and route behavior. | 96/97 wire and route boundary cases share the exported schema/constant. |
| Pre-hardening rows could fail storage validation or be cleaned by a broad prefix. | Legacy persisted-key completion and exact-key cleanup case keeps a sibling object intact. |

### Cluster F verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts \
  --silent --reporter=dot

Test Files  9 passed (9)
Tests       116 passed (116)

pnpm --dir packages/happy-wire exec vitest run src/interactivePreview.test.ts --reporter=dot
Test Files  1 passed (1)
Tests       14 passed (14)

pnpm --dir packages/happy-cli exec vitest run src/previews/previewApi.test.ts --config /dev/null --reporter=dot
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-wire run build && pnpm --dir packages/happy-wire run typecheck
pnpm --dir packages/happy-cli run typecheck
pnpm --dir packages/happy-server run typecheck
all exit 0

PGLITE_DIR=$(mktemp -d /tmp/happy-task3-pglite.XXXXXX) \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 44 migration(s), including 20260904130000_fence_vercel_reconnects.

git diff --check
exit 0
```

## Cluster E review-fix follow-up: expiry ambiguity and provider-delete checkpoints

An attempt for which Vercel creation has started but no deployment ID is yet
bound is now treated as externally ambiguous throughout expiry. At the expiry
deadline a failed reconciliation moves that row to `deleting` with durable
provider-reconciliation and cleanup retry deadlines; it is never converted to
an ordinary `failed` expiry candidate. Ordinary cleanup excludes every row
with `publicationCreateStartedAt` and no bound provider ID, so it cannot prune
staging while a provider outcome remains unknown. Recovery processes batches
until the candidate set is drained for the pass, with already-handled IDs
excluded from later queries; a 51-row persisted regression proves the former
50-row cap cannot let overflow rows race normal cleanup.

Provider deletion is now checkpointed before any OSS deletion. The checkpoint
is a claimed CAS that clears `vercelDeploymentId` and resolves the publication
attempt before staging is touched. Therefore an OSS failure leaves a durable
OSS-only retry that no longer needs Vercel credentials. This path is used by
the scheduled cleanup worker, disconnect drain, ordinary explicit/session
deletion through the cleanup worker, and delayed-create compensation. The
checkpoint clears only lifecycle identifiers and stable error codes; no
provider credential, response body, signed URL, or token is persisted or
logged.

### Cluster E red/green evidence

| Regression | Red observation | Green result |
| --- | --- | --- |
| Provider 503 exactly at expiry | The persisted row became `expired` with `PUBLISH_RECONCILIATION_EXPIRED` and no retry deadline. | It remains `deleting`, retains its create marker/staging, and records both reconciliation and cleanup backoff at `+1 minute`. |
| More than 50 ambiguous rows | The former recovery query stopped at `take: 50`, allowing the first batch to become ordinary cleanup candidates while the overflow was untouched. | All 51 persisted attempts finish the pass as ambiguous deleting tombstones; no overflow row is expired. |
| Provider succeeds then OSS fails | The cleanup helper called staging deletion immediately after provider deletion, leaving the provider ID for the next retry. | The provider checkpoint is observed between provider and OSS operations; the retry operates with no provider ID. |
| Disconnect checkpoint | Disconnect deleted the provider deployment then failed OSS cleanup without durably resolving its provider boundary. | After credential removal, a cleanup pass removes only OSS state and makes no second Vercel delete request. |
| Late create compensation | A successful compensating delete left the durable provider ID/attempt for a later worker. | The fenced explicit-delete case clears the provider ID and attempt, removes OSS staging, and ends expired. |

### Cluster E verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts \
  --silent --reporter=dot

Test Files  9 passed (9)
Tests       105 passed (105)

pnpm --dir packages/happy-cli exec vitest run \
  src/previews/previewApi.test.ts --config /dev/null --reporter=verbose

Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-server run typecheck
exit 0

PGLITE_DIR=$(mktemp -d /tmp/happy-task3-pglite.XXXXXX) \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 43 migration(s), including
20260904120000_reconcile_interactive_preview_attempts.

git diff --check
exit 0
```

## Cluster D review-fix follow-up: autonomous recovery and unresolved cleanup

The publication attempt is now a durable recovery record rather than a
best-effort request boundary. The `20260904120000_reconcile_interactive_preview_attempts`
migration adds `publicationCreateStartedAt`,
`publicationReconcileRetryCount`, and `publicationReconcileNextAttemptAt`.
Creation is marked before the Vercel create call. Once this marker exists, a
failed/invisible attempt is never eligible for a second create: it remains a
publishing or deleting tombstone until scheduler reconciliation reaches a
provider result or its original expiry deadline.
The migration also conservatively upgrades legacy attempt-ID rows from the
previous lifecycle into this reconciliation state, including deleting rows
whose deployment ID was not yet observed.

`lookupDeploymentByMetadata` deliberately reports four provider outcomes:
`not_found`, `in_progress`, `ready`, and `terminal`. It performs no readiness
polling. Both interactive publication and the scheduler bind the discovered
deployment ID before `waitForDeploymentReady`, including `BUILDING` and
`QUEUED` deployments. The default cleanup scheduler invokes
`previewService.recoverStalePublications` on every pass, before normal expiry
cleanup, and recovery never creates a deployment. Provider polling and retry
scheduling are bounded by the persisted exponential cadence and the existing
preview expiry deadline.

Delete, session deletion, and disconnect now fence a possibly-active
publisher into a durable deletion tombstone. A fenced publisher that later
receives a Vercel deployment ID binds it through an account-plus-attempt CAS,
independent of `publicationGeneration`, then performs compensating deletion.
If that deletion fails the ID, retry count, and due time remain persisted for
the normal credential-backed cleanup worker. A deleting attempt whose metadata
is not yet visible retains both reconciliation and cleanup due times instead
of being expired prematurely.

Disconnect drains this work while its credential is still available. It then
removes the encrypted credential as required, but returns the fixed
`VERCEL_DEPLOYMENT_CLEANUP_PENDING` warning whenever an unresolved or failed
cleanup tombstone remains; the tombstone is intentionally retained for manual
provider removal rather than reporting false success. Explicit delete and
session deletion retain their credential-backed retry path.

### Cluster D red/green evidence

The provider lifecycle test was introduced against the absent lookup API and
failed with `lookupDeploymentByMetadata is not a function`. The new API and
pre-poll binding made it green. The invisible-deployment deletion case was
then made red by removing the write of `cleanupNextAttemptAt`: normal cleanup
incorrectly changed the tombstone to `expired`. Restoring that durable retry
write keeps it `deleting` until provider visibility or deadline.

The full persisted integration run also initially exposed test-harness
starvation: a fixed count of `setImmediate` retries could complete before the
local fake Vercel HTTP request was scheduled under the combined suite. The
helper now uses a bounded wall-clock, condition-based wait, and the full suite
is deterministic without changing production timing.

### Cluster D persisted integration coverage

The PGlite and production HTTP-client harness covers all of the review
scenarios:

| Case | Durable boundary assertion |
| --- | --- |
| Scheduler restart recovery | A delayed-visibility `BUILDING` deployment becomes ready after restart when only the scheduler runs; it makes zero new Vercel create requests. |
| Explicit delete | A held create response arrives after the delete fence; failed compensation retains the returned deployment ID and a due retry tombstone. |
| Session deletion | The production transaction fences the preview before removing its session relation; the same delayed-create cleanup state survives. |
| Disconnect | Delayed/failing provider cleanup returns the fixed warning and removes the credential while retaining the provider-ID tombstone. |
| Invisible deletion | Scheduler metadata `not_found` leaves a pre-create tombstone deleting with both durable retry deadlines. |

### Cluster D verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts \
  --silent --reporter=dot

Test Files  9 passed (9)
Tests       101 passed (101)

pnpm --dir packages/happy-cli exec vitest run \
  src/previews/previewApi.test.ts --config /dev/null --reporter=verbose

Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-server run typecheck
exit 0

PGLITE_DIR=/tmp/happy-task3-pglite.<random> \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 43 migration(s), including
20260904120000_reconcile_interactive_preview_attempts.

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

## Cluster A review-fix follow-up

### Contract migration delivered

- Staging identity is now `accountId + previewId + stagingGeneration + assetId`. New keys are `private/interactive-previews/<account>/<preview>/<generation>/<asset>`; relative filenames remain manifest-only and never participate in storage-key construction.
- Upload descriptors expire after exactly ten minutes. All asset completion and publication reads take the persisted `InteractivePreviewAsset.storageKey`, while cleanup and Vercel disconnect delete only the exact persisted account/preview/generation prefix.
- Draft creation canonicalizes immutable manifests, checks session ownership, creates the preview and asset records atomically through Prisma's nested create, and treats a unique-key race as an idempotent retry only when account, session, and canonical manifest all match. Matching retries receive fresh upload descriptors from the persisted asset keys; owner/session/manifest mismatches return the same not-found error without exposing an existing record.
- Every preview route is now session-scoped: `/v1/sessions/:sessionId/previews/:previewId/{draft,assets/:assetId/uploaded,publish}`, `GET /v1/sessions/:sessionId/previews`, and `DELETE /v1/sessions/:sessionId/previews/:previewId`. Route and service layers both enforce account plus session ownership. Scoped misses are normalized to `404 { error: 'Preview not found' }`.
- The CLI follows the new routes, sends the workspace preview ID in the draft path, and rejects a descriptor response whose preview ID does not match the locally issued workspace.
- The existing lifecycle migration `20260904110000_harden_interactive_preview_lifecycle` already contains the required `stagingGeneration` and persisted `storageKey` foundation. No data-destructive migration was added; fresh PGlite applies the current migration chain successfully.

### Review-fix TDD evidence

| Behavior | Red evidence | Green evidence |
| --- | --- | --- |
| Scoped opaque storage and exact expiry | Storage test expected an account/preview/generation key and 10-minute expiry but received the prior preview-only key | `previewStorage.spec.ts`: 7 passing |
| Idempotent immutable draft reuse | Service test observed a duplicate Prisma create and leaked unique-constraint error for a reused ID | `previewService.spec.ts`: 15 passing |
| Session route contract | New canonical URLs returned 404 under the legacy routing implementation | `interactivePreviewRoutes.spec.ts`: 5 passing |
| Scoped missing preview response | A service `Preview not found` initially surfaced as HTTP 500 | Route response is now safe HTTP 404 |
| CLI URL migration | The CLI test received an invalid draft response because it still called the old `/drafts` endpoint | `previewApi.test.ts`: 1 passing |
| Cleanup staging isolation | Cleanup passed only a preview ID rather than full generation scope | `previewCleanup.spec.ts`: 5 passing |
| End-to-end persisted storage identity | Local integration initially failed against legacy routes and old storage identity calls | `interactivePreview.integration.spec.ts`: 4 passing |

### Follow-up verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts

Test Files  5 passed (5)
Tests       36 passed (36)

pnpm --dir packages/happy-cli exec vitest run \
  src/previews/previewApi.test.ts --config /dev/null --reporter=verbose

Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-server run typecheck
pnpm --dir packages/happy-cli run typecheck
exit 0

PGLITE_DIR=/tmp/happy-preview-pglite.TwoQ5v \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 42 migration(s), including 20260904090000_add_interactive_previews,
20260904100000_add_interactive_preview_cleanup_retries, and
20260904110000_harden_interactive_preview_lifecycle.

git diff --check
exit 0
```

## Cluster B review-fix follow-up: durable publication and cleanup state machine

- Publication now writes a durable `publicationAttemptId` before any provider operation, reuses it after a restart, and binds `publicationGeneration` plus `connectionGeneration` into the claim, deployment-created, and ready transitions. A stale publisher that loses either fence cannot restore a deleted/disconnected preview to `ready` or overwrite another live deployment ID.
- The Vercel client scopes metadata reconciliation to the resolved project and both Happy metadata keys (`happyPreviewId`, `happyPublicationAttemptId`). It waits for a reconciled deployment to become `READY`; deployment creation is deliberately excluded from the transient HTTP retry loop, so a lost create response is reconciled instead of retried blindly.
- Explicit delete and disconnect preserve an existing worker's cleanup claim/retry deadline. Disconnect first fences all nonterminal rows, reconciles active attempts where credentials and a project are available, performs best-effort provider and staging removal, and only then discards the encrypted credential. A live worker claim or failed reconciliation returns the fixed `VERCEL_DEPLOYMENT_CLEANUP_PENDING` warning; no plaintext token is retained.
- Session deletion now fences its nonterminal previews into `deleting` tombstones before deleting the session. Because the FK uses `SetNull`, those tombstones retain account, staging, attempt, and provider metadata for the cleanup loop. The integration regression verifies a `sessionId = null` tombstone removes both the Vercel deployment and its exact staging prefix.
- Successful publication persists `stagingCleanupPending` before staging removal. If that removal fails, cleanup retries staging only with durable backoff while the ready deployment remains live until its unchanged 24-hour expiry. Cleanup ownership is now an exact-claim CAS for success and retry paths; it clears provider IDs only after external deletion and prunes only fully-cleaned `expired` rows after 30 days.

### Cluster B red/green evidence

| Behavior | Red evidence | Green evidence |
| --- | --- | --- |
| Provider reconciliation | metadata lookup method was absent; a retry issued a second deployment create | client resolves the existing attempt within the project and create POST is called once on 503 |
| Generation fencing | a delayed publisher could make a deleted row ready | delayed `onCreated` loses its CAS and removes the unclaimed provider deployment |
| Ready staging retry | cleanup deleted `dpl_live` while staging cleanup was pending before expiry | cleanup clears only `stagingCleanupPending` and leaves ready/deployment intact |
| Session deletion | no preview tombstone was written before `Session.delete` | session test observes the fenced tombstone before relation removal; SetNull integration cleanup deletes Vercel and OSS resources |

### Cluster B verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts

Test Files  8 passed (8)
Tests       88 passed (88)

pnpm --dir packages/happy-server run typecheck
exit 0

PGLITE_DIR=/tmp/happy-preview-pglite.<random> \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 42 migration(s)
```

## Cluster C review-fix follow-up: persisted provider boundaries

`interactivePreview.integration.spec.ts` now replaces its Map database and
in-process S3 fake with a deterministic persisted-boundary harness:

- Each case applies all current migrations to a fresh on-disk PGlite directory,
  opens Prisma through the production PGlite adapter, and creates authenticated
  account/session fixtures. Restart cases close Fastify, Prisma, and PGlite,
  then recreate all three objects against that same directory.
- A local HTTP S3-compatible server is driven by the production MinIO client
  and `createPreviewStorage`. It implements only bucket-region discovery,
  policy POST upload, HEAD/GET, prefix listing, and multi-object deletion;
  tests assert the private bucket, persisted opaque key, exact uploaded body,
  and object size at the HTTP boundary.
- A local HTTP Vercel server is driven solely by `createVercelClient`. It
  verifies bearer scope, serial file upload behavior, deployment metadata
  reconciliation, creation, and deletion/retry responses. The fixture uses
  the production encrypted credential repository/store and confirms distinct
  account-scoped encryption paths and ciphertext records.

### Persisted integration cases

| Case | Boundary assertion |
| --- | --- |
| Draft → upload → publish | Authenticated routes issue direct presigned S3 POST descriptors; completion HEAD-checks exact bytes; production Vercel uploads assets one at a time; the typed ready event is returned and the exact staging prefix is empty. |
| Global publication cap | Three persisted previews hold at two simultaneous Vercel create requests; duplicate in-flight publication returns `publishing` and creates no extra deployment. |
| Restart/reconciliation | A stale persisted `publishing` attempt is recovered after app/database recreation, reconciled by both Vercel metadata keys without a new create, then a restarted deletion tombstone obeys `nextAttemptAt` before provider and S3 cleanup. |
| Delete/prune/ownership | Explicit deletion survives provider failure as a retry tombstone, expires after the due retry, and is pruned after 30 days; cross-account and cross-session list/complete/publish/delete calls receive 404. |
| Ready staging retry | A failed staging delete stays `ready` with its live deployment; cleanup retries only staging and never deletes the provider deployment before expiry. |

### Cluster C red/green evidence

The first replacement run failed before implementation of the test harness was
complete: fresh 42-migration PGlite setup exceeded Vitest's five-second default
test timeout, canonical persisted asset ordering invalidated a manifest-order
assumption, and concurrent fake deployment responses accidentally reused an ID.
The harness now gives the migration cases a bounded 30-second allowance,
asserts persisted ordering, and allocates a deployment ID when the provider
request arrives. The resulting cases exercise production behavior rather than
test doubles.

### Cluster C verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/interactivePreview.integration.spec.ts

Test Files  1 passed (1)
Tests       5 passed (5)

pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts

Test Files  9 passed (9)
Tests       96 passed (96)

pnpm --dir packages/happy-server run typecheck
exit 0

PGLITE_DIR=/tmp/happy-task3-pglite.<random> \\
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 42 migration(s), including 20260904090000_add_interactive_previews,
20260904100000_add_interactive_preview_cleanup_retries, and
20260904110000_harden_interactive_preview_lifecycle.

git diff --check
exit 0
```

## Cluster I quality-review follow-up: scoped legacy deletion and activation consistency

This supersedes the Cluster H statement that an unscoped deployment 404 can
prove an unknown legacy deployment is absent. It cannot: Vercel can hide a
team deployment from the personal endpoint.

- Legacy-scope resolution now uses only the current encrypted credential's
  proven team candidate. The Vercel request itself carries that `teamId`; a
  found row is bound to that team before deletion. An unknown legacy row has no
  personal candidate, so it is never queried/deleted as personal.
- A 404 for an unknown legacy row is inconclusive. Scheduled recovery,
  disconnect, and scope-changing reconnect retain its deployment ID and
  `deleting` tombstone, persist the bounded cleanup retry, and expose the
  existing fixed manual-cleanup warning on disconnect. A provider 404 remains
  an idempotent success only when the stored row already proves the matching
  team or explicitly proves personal scope.
- Encrypted credentials are now authorized only if the Account is `active` and
  its epoch/nonce exactly match the encrypted envelope (legacy zero/null values
  match only the zero/null Account baseline). Status consumes this guarded
  view, and publication/recovery/disconnect/reconnect do likewise; the raw
  credential’s presence no longer means connected.
- The encrypted repository provides an exact-snapshot conditional delete.
  Therefore a stale credential written after disconnect can be reconciled by a
  later status or reconnect without deleting a concurrently installed newer
  credential. A live process records its own short `replacing`/`finalizing`
  callback window, so its matching credential remains inactive but intact
  until activation. A fresh process has no such marker: its next status read
  conditionally deletes the interrupted snapshot before recovery/reconnect.

### Cluster I red/green evidence

| Behavior | Red evidence | Green regression coverage |
| --- | --- | --- |
| Unknown scope 404 | The current team’s 404 cleared `vercelDeploymentId` and expired the row. | Cleanup, disconnect, and stale-publication recovery keep the deleting tombstone, deployment ID, and retry deadline. |
| Candidate-scoped team proof | Legacy resolution issued an unscoped request. | The client includes the encrypted candidate `teamId`; a matching found deployment is bound then deleted. |
| Explicit personal 404 | Personal and unknown null scopes had the same behavior. | An explicitly known personal row retains normal idempotent 404 deletion, while unknown remains manual cleanup. |
| Credential/Account crash gap | A present encrypted token made status connected and could authorize a publisher before Account activation. | Status returns disconnected, publisher makes no Vercel call for a version mismatch, and a fresh-process status read conditionally reconciles a `createIfAbsent` barrier before later reconnect safely activates its newer credential. |
| Stale cleanup safety | Conditional reconciliation could delete a replacement credential. | Exact ciphertext snapshot deletion removes the stale record only; a newer record survives. |

No new migration is required for Cluster I: the existing connection epoch/nonce
columns and encrypted credential envelope fields from
`20260904150000_harden_vercel_connection_fences` are reused.

### Cluster I verification

```text
pnpm --filter happy-server-self-host exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/vercelScopeMigration.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts \
  --reporter=dot --silent --maxWorkers=1 --minWorkers=1

Test Files  10 passed (10)
Tests       141 passed (141)

pnpm --filter @slopus/happy-wire exec vitest run src/interactivePreview.test.ts --reporter=dot
Test Files  1 passed (1)
Tests       14 passed (14)

pnpm --filter @wangjs-jacky/paws exec vitest run src/previews/previewApi.test.ts --config /dev/null --reporter=dot
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --filter happy-server-self-host run typecheck
pnpm --filter @slopus/happy-wire run typecheck
pnpm --filter @wangjs-jacky/paws run typecheck
all exit 0

PGLITE_DIR=$(mktemp -d /tmp/happy-task3-cluster-i.XXXXXX) \
  pnpm --filter happy-server-self-host exec tsx sources/standalone.ts migrate
Applied 46 migration(s), including 20260904150000_harden_vercel_connection_fences

git diff --check
exit 0
```

## Cluster J quality-review follow-up: cross-process credential activation

- `provider:vercel` remains the active predecessor record while replacement
  and disconnect drains run. The replacement is instead encrypted at the
  deterministic, account-bound pending vendor key
  `provider:vercel:pending:<epoch>:<nonce>`; its envelope carries the same
  epoch and nonce as the durable Account operation.
- Pending promotion is one Prisma transaction: it checks the exact
  `finalizing` Account epoch/nonce/replacement ID, validates the encrypted
  pending envelope, CAS-replaces the active row, removes that exact pending
  snapshot, then CAS-marks Account `active`. Consequently a crash cannot
  expose an active Account without its matching active credential.
- No process-local liveness state remains. Fresh service instances use only
  the persisted lease. A non-expired `replacing`/`finalizing` operation is
  inactive but untouched; after the lease expires, recovery atomically moves
  it fail-closed to `disconnected`, removes only its exact pending row, and
  preserves the predecessor for a deliberate subsequent cleanup/reconnect.
- Disconnect now drains with that predecessor, then uses a transactionally
  exact Account and encrypted-row CAS to delete the predecessor/pending rows
  and mark disconnected. A delayed disconnect cannot remove a credential
  activated by a later reconnect.

### Cluster J red/green evidence

| Regression initially exposed | Green persisted coverage |
| --- | --- |
| A fresh process treated a live `finalizing` callback as dead because `liveReplacementIds` was empty, deleting the credential that its original callback still needed. | A PGlite write barrier persists pending state; a second service reports inactive without deleting predecessor/pending, then the original callback atomically activates with the credential present. |
| A callback crash between credential persistence and Account activation could leave either an unauthorized active record or no durable cleanup target. | A held pending write simulates the crash; only after durable lease expiry does a fresh service remove the exact pending row, fail closed, preserve the predecessor, and complete a later reconnect. |
| Scope-drain failure or reconnect/disconnect ordering could erase the old cleanup credential or a newer replacement. | PGlite cases retain the predecessor after a failed old-scope drain, then reconnect successfully; they cover reconnect→disconnect→reconnect and delayed disconnect→reconnect, asserting the later active credential survives. |

### Cluster J verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/vercelScopeMigration.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts \
  --reporter=dot --silent --maxWorkers=1 --minWorkers=1

Test Files  10 passed (10)
Tests       144 passed (144)

pnpm --dir packages/happy-wire exec vitest run src/interactivePreview.test.ts --reporter=dot
Test Files  1 passed (1)
Tests       14 passed (14)

pnpm --dir packages/happy-cli exec vitest run src/previews/previewApi.test.ts --config /dev/null --reporter=dot
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-server exec prisma generate
pnpm --dir packages/happy-server run typecheck
pnpm --dir packages/happy-wire run typecheck
pnpm --dir packages/happy-cli run typecheck
all exit 0

PGLITE_DIR=$(mktemp -d /tmp/happy-task3-cluster-j.XXXXXX) \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 46 migration(s). No schema migration was needed: pending credentials
reuse the existing per-account ServiceAccountToken vendor-key uniqueness.

git diff --check
exit 0
```

## Cluster K final concurrency fix: transactional successor ownership

- Reconnect and disconnect now obtain an Account-version snapshot first, then
  enter one Prisma transaction that conditionally updates/locks that exact
  Account row, reads the encrypted active predecessor in the same transaction,
  advances the epoch/nonce, and removes every older Vercel pending vendor row
  before a successor can stage its own future pending row.
- Scope comparison and preview fencing use only that returned,
  transactionally-read predecessor snapshot. A callback that observed an older
  Account version loses the CAS before it can preserve a newer scope, alter its
  previews, stage a pending credential, or activate itself.
- Pending credential staging now has no non-transactional API. It first locks
  the exact `finalizing` Account epoch/state/nonce and only then upserts its
  encrypted pending row. Activation and disconnect finalization take the same
  exact Account lock before touching encrypted rows.
- The predecessor remains active only for the existing old-scope drain. Tokens
  remain encrypted under the account-scoped provider path and neither token
  material nor provider responses are logged or persisted in lifecycle state.

### Cluster K red/green evidence

| Regression initially exposed | Green regression coverage |
| --- | --- |
| A crashed callback's pending credential survived a later disconnect/reconnect because finalization deleted only its exact pending key. | Persisted PGlite state stages a crashed `finalizing` row, completes a successor disconnect plus reconnect without resuming the old callback, and asserts no pending vendor row remains. |
| Callback A could read predecessor A, then callback B activate a different scope; A resumed, treated stale A as same-scope, and activated itself. | A persisted Account-read barrier lets B activate and create a B-scoped draft; A's exact Account CAS fails, B remains active, the B draft keeps its generation, and no A pending row exists. |
| Pending staging could occur after ownership was lost. | Store-level transaction test verifies the exact Account lock, returned encrypted predecessor snapshot, vendor-prefix pending cleanup, and rejection of a late stage after a newer Account version. |

### Cluster K verification

```text
pnpm --dir packages/happy-server exec vitest run \
  sources/app/previews/previewStorage.spec.ts \
  sources/app/previews/previewService.spec.ts \
  sources/app/previews/previewCleanup.spec.ts \
  sources/app/previews/vercelCredentialStore.spec.ts \
  sources/app/previews/vercelClient.spec.ts \
  sources/app/previews/vercelScopeMigration.spec.ts \
  sources/app/previews/interactivePreview.integration.spec.ts \
  sources/app/api/routes/interactivePreviewRoutes.spec.ts \
  sources/app/api/routes/vercelConnectRoutes.spec.ts \
  sources/app/session/sessionDelete.spec.ts

Test Files  10 passed (10)
Tests       147 passed (147)

pnpm --dir packages/happy-wire exec vitest run src/interactivePreview.test.ts
Test Files  1 passed (1)
Tests       14 passed (14)

pnpm --dir packages/happy-cli exec vitest run src/previews/previewApi.test.ts --config /dev/null
Test Files  1 passed (1)
Tests       1 passed (1)

pnpm --dir packages/happy-server exec prisma generate
pnpm --dir packages/happy-server run typecheck
pnpm --dir packages/happy-wire run typecheck
pnpm --dir packages/happy-cli run typecheck
all exit 0

PGLITE_DIR=$(mktemp -d /tmp/happy-task3-cluster-k-migrate.XXXXXX) \
  pnpm --dir packages/happy-server exec tsx sources/standalone.ts migrate
Applied 46 migration(s). No schema migration was needed.

git diff --check
exit 0
```
