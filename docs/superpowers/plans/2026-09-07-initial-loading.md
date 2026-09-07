# Initial loading implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make initial Paws Web loading responsive, retain readable cached sessions, and replace indefinite waiting with recoverable failure.

**Architecture:** Start account/crypto restoration alongside fonts; retain native font prerequisites. Hydrate session snapshots in bounded batches with cancellation fences checked at commit, yielding between batches. Keep historical hydration outside first paint; give list requests a bounded lifetime and expose retry without hiding cached data. Use the current origin for the already verified additional Web host.

**Tech Stack:** Expo, React 19, Zustand, IndexedDB, Vitest, Node test, Ego browser.

**Spec:** User-approved directions in this conversation, captured below.

## Global Constraints

- Implement only in `/Users/jacky/jacky-github/happy--fix-initial-loading`; root workspace stays clean main.
- Existing readable sessions remain visible during refresh, timeout, offline operation, and retry.
- Preserve local-history account ownership, deletion fences, version ordering, deep-link prioritization and authoritative deletion semantics. A missing row in a page is not deletion.
- Keep explicit custom server selection and native server behavior; add only verified `121.43.32.242` to the Web runtime HTTPS host allowlist. Do not change the production deployment origin contract.
- Use current theme semantic tokens and existing localized copy for loading/error/retry; no hardcoded UI colors.
- No production deployment, merge, daemon restart, backend changes, dependency upgrades, or runtime changes in implementation.
- Browser operations use Ego only. Screenshot comparison is pending an optional user answer; unit, type and performance validation continue independently.

## Acceptance contract

1. On Web a never-resolving font download does not hold credentials, synchronization or the app shell. Native initialization still waits for fonts before rendering.
2. A page of sessions is applied in bounded batches instead of one store update per row, with event-loop opportunities between batches. Same-version unchanged snapshots do not cause redundant list notifications.
3. Cached and first useful sessions become visible without waiting for historical pages. Automatic history work starts after an interactive/idle opportunity, remains deduplicated, and manual pagination/retry remains effective.
4. Session-list network operations time out including stalled response bodies, publish a recoverable failure state, and release their in-flight slot. Retry must work. Cached content is never replaced by a full-page spinner or error.
5. HTTPS Web at `121.43.32.242` uses its same-origin API just as the existing approved hosts do; arbitrary hosts and explicit user server choices remain unaffected.

## Task 1: Responsive and recoverable first load

**Files / responsibilities:**
- `packages/happy-app/sources/components/appRoot/AuthenticatedRootLayout.tsx` and `.test.tsx`: Web boot prerequisites.
- `packages/happy-app/sources/components/appRoot/appRootFonts.ts` and `.test.ts`: retained native prerequisites and safe background Web font loading if needed.
- `packages/happy-app/sources/sync/sync.ts`, `sessionBootstrap.test.ts`, and relevant existing local-history tests: batch commits, deduplication, history scheduling and cancellation.
- `packages/happy-app/sources/sync/apiSessions.ts` and `apiSessions.test.ts`: bounded list request/body lifetime.
- Optional focused helpers `sessionListSyncState.ts` and `sessionSnapshotBatch.ts` with colocated tests: isolate observable loading state and batching policy if this keeps sync.ts changes small.
- `packages/happy-app/sources/components/SessionsListWrapper.tsx` and colocated tests: loading failure and retry; inspect other primary sidebar consumers and share the state when needed.
- `scripts/inject-web-runtime-server-config.mjs` and `.test.mjs`: verified same-origin routing.

**Interfaces:** Existing `bootstrapSessions(): Promise<void>`, `sessionRouteBecameInteractive(): Promise<void>`, `loadNextSessionHistoryPage(): Promise<void>` remain callable. Preserve API snapshot/page return types. State helper, if used, exports a typed loading/error snapshot and hook; UI consumes this instead of duplicating retry state.

- [x] Establish focused baseline and record failures before changes.
  Run `pnpm --filter happy-app exec vitest run sources/sync/sessionBootstrap.test.ts sources/components/appRoot/AuthenticatedRootLayout.test.tsx sources/sync/apiSessions.test.ts` and `node --test scripts/inject-web-runtime-server-config.test.mjs`.
- [x] Add behavioral regression cases and watch them fail against existing implementation.
  Boot case: a deferred `loadAppRootFonts` Promise stays pending while a real root render reaches its shell and calls account restore on Web; native retains the prerequisite. Batch case: observe application boundary notifications for a page and assert fewer notifications than rows, complete session contents, and a scheduled event running between chunks. Race cases: deletion, new encryption owner and a newer competing snapshot during yielding never resurrect or regress rows. Error cases: mock a stalled fetch and a separately stalled `response.json`, advance fake time, verify failure settles, then retry successfully; pending history must not hide existing rows. Runtime script case executes generated script with `https://121.43.32.242:8443` and expects that exact `serverUrl` while unapproved hosts stay unchanged.
- [x] Implement boot orchestration without blocking Web on fonts.
  Start the handled font Promise before credentials/crypto work; await it only for native. Keep `setInitState` after account restore and keep accurate stage marks.
  ```ts
  const fonts = loadAppRootFonts();
  // Web attaches a rejection handler immediately; native awaits fonts.
  // Account/crypto initialization proceeds without awaiting Web fonts.
  ```
- [x] Implement bounded batch preparation/commit and no-op avoidance.
  Start with batches of 10 snapshots and a macrotask yield between batches; check current account, deletion fence and encryption ownership again at each synchronous commit. Do not commit encryption long before its corresponding store row. Preserve partial-progress and single-session deep-link behavior. Reuse batch handling for local-history snapshot enumeration instead of wrapping each snapshot in its own write call. Bound corruption handling to the affected snapshot.
  ```ts
  // After private preparation and a final current-owner check:
  this.applySessions(batch, { replace: false });
  // Yield before preparing the next non-empty batch.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  ```
- [x] Implement recoverable loading and defer history beyond first useful paint.
  Use a 20-second request deadline covering headers and JSON body, always clean up timers and abort resources. Bootstrap owns a deduplicated in-flight attempt and loading/error state; failures settle instead of being swallowed by an unbounded retry loop. Explicit retry starts a fresh attempt. Keep already-visible sessions through all transitions. Automatic history schedules an idle opportunity with a bounded fallback; manual pagination is not held behind that delay. Stale scheduled tasks must not touch another account.
- [x] Extend the approved Web host list and preserve its existing safeguards.
  ```js
  ["paws.rodeo", "47.115.228.20", "121.43.32.242"].includes(l.hostname)
  ```
- [x] Run focused regression suites, all relevant sync/local-history tests, app typecheck, OTA runtime contract test, and Node runtime-config tests. Run broader app tests once if practical; report unrelated baseline failures accurately. The controller handles the production-style Web build and browser performance verification.
- [x] Self-review and commit only this task's changes with a Chinese conventional commit subject. Record RED/GREEN commands, results and limitations in the task report. No push, merge, browser automation, or subagents from the implementer.

## Delivery verification

The controller reviews the implementation independently, builds Web, measures the resulting first-load flow, and prepares a PR with tests and explicit screenshot status. Repository CI can provide a directed Preview OTA. Production deployment remains through the normal merge workflow, with merge authorization resolved only after the concrete PR is reviewable.
