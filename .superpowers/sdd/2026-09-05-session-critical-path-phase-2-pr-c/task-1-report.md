# PR C / Task 1 report

## Result

Implemented the browser-side startup trace runtime and probe bridge. The exported
singleton is `sessionStartupTraceRuntime`; it keeps only in-memory handle/session
maps, de-duplicates stages, rejects stale same-session cleanup, and clears a
binding on terminal completion, cancellation, explicit finish, or five-minute
expiry.

## RED evidence

1. Initial stage/runtime/bridge RED command:

   ```sh
   pnpm --filter happy-app exec vitest run \
     sources/sync/sessionStartupTrace.test.ts \
     sources/sync/sessionStartupTraceRuntime.test.ts \
     sources/sync/sessionCriticalPathProbeBridge.test.ts \
     sources/components/appRoot/appRootFonts.test.ts \
     sources/components/appRoot/AuthenticatedRootLayout.test.tsx
   ```

   Result: failed as expected. `web.processor.ready_received` serialized as
   `null`; `sessionStartupTraceRuntime` and `sessionCriticalPathProbeBridge`
   were unresolved modules.

2. Spawn/realtime RED command:

   ```sh
   pnpm --filter happy-app exec vitest run \
     sources/hooks/useSpawnSession.test.tsx \
     sources/sync/sync.messageVisibility.test.ts
   ```

   Result: failed as expected. The spawn test observed no runtime handle and
   the normalized encrypted ready-event path emitted no processor-ready stage.

## Implementation summary

- Extended sanitized startup trace stages for processor-ready, first-agent-event,
  and turn-completed.
- Added runtime lifecycle, idempotency, stale-handle protection, best-effort
  writer isolation, and bounded expiry.
- Added the optional document-probe bridge; it only calls fixed probe methods
  and has no persistence, storage, credential, or response-data access.
- Bound spawned sessions only once the RPC returned a session ID; errors and
  cancellation clean up the handle.
- Marked only decrypted, normalized ready/agent/turn-completion semantics in
  Sync, and added fixed boot, snapshot, latest-message, store, and browser-paint
  probe milestones at their existing boundaries.
- Added a TypeScript asset-module declaration so the font imports typecheck.

## Verification

1. Required green command:

   ```sh
   pnpm --filter happy-app exec vitest run \
     sources/sync/sessionStartupTrace.test.ts \
     sources/sync/sessionStartupTraceRuntime.test.ts \
     sources/sync/sessionCriticalPathProbeBridge.test.ts \
     sources/components/appRoot/appRootFonts.test.ts \
     sources/components/appRoot/AuthenticatedRootLayout.test.tsx \
     sources/-session/SessionView.hydration.test.tsx \
     sources/hooks/useSpawnSession.test.tsx \
     sources/sync/sync.messageVisibility.test.ts
   node --test packages/happy-app/scripts/check-session-critical-path.test.mjs
   ```

   Result: 8 Vitest files / 69 tests passed; probe script 49/49 passed.

2. Typecheck:

   ```sh
   pnpm --filter happy-app exec tsc --noEmit --pretty false --incremental false
   ```

   Result: exit 0 with no diagnostics.

## Self-review

- Runtime internals are private maps; no state is persisted or exported.
- The serializer remains the only trace writer boundary.
- `markSessionStage` resolves the current session record, so a stale handle
  cannot clear or consume a newer same-session binding.
- Probe failures are caught locally and cannot affect rendering.
- Tests assert observed trace/probe behavior and real normalized-message flow;
  test doubles represent external writers/probes only.

## Commit

Implementation commit: `1bec29d4` (`feat(observability): measure processor-ready startup`).

## Risks

- The existing message-visibility suite intentionally logs a synthetic failed
  second-page request to stderr; the suite still exits successfully.
- Browser paint marks require `requestAnimationFrame`; non-web platforms do not
  emit those optional document-probe milestones.
