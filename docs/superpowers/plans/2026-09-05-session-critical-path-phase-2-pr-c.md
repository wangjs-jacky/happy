# Session Critical Path Phase 2 PR C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build trustworthy double-metric startup attribution and eliminate the four known correctness races that invalidate current PC Web session performance measurements.

**Architecture:** Extend the existing redacted startup trace with browser-owned end-to-end milestones and component-local spans, while keeping all evidence memory-only or in fixed-schema logs. Introduce explicit route-opening ownership, a contiguous backward-pagination frontier, and attachment-selection generations; preserve existing deletion, encryption, outbox, and reconnect contracts.

**Tech Stack:** TypeScript, React/React Native Web, Expo Router, Zustand, Socket.IO, Vitest, Node test runner, Ego Browser.

**Spec:** `docs/superpowers/specs/2026-09-05-session-critical-path-phase-2-design.md`

## Global Constraints

- Deep-link gates are P50 <= 2000 ms and P95 <= 4000 ms.
- New-session navigation gates are P50 <= 7000 ms and P95 <= 10000 ms.
- Processor-ready gates are P50 <= 10000 ms and P95 <= 15000 ms.
- `processor ready` means the real message-consumption handler is registered and the initiating Web client receives the encrypted `{ type: 'ready' }` session event.
- Browser evidence must contain only allowlisted stage durations, retry count, sample classification, and redacted resource paths.
- Never persist prompts, messages, credentials, paths, commands, tokens, attachment URIs, machine IDs, session IDs, or raw exceptions in acceptance evidence.
- Browser startup must make zero exact-path `/v1/sessions` requests.
- Observability is best effort in production and must never delay or fail startup; acceptance collection fails closed when mandatory evidence is absent or malformed.
- Keep end-to-end encryption, deletion generations, route ownership, atomic outbox receipt, real reconnect recovery, and draft survival behavior intact.
- All behavior changes use RED -> GREEN; each RED must fail for the missing behavior before production code changes.
- Collect at least five cold and five warm samples for each deep-link or spawn metric group before calculating its reported nearest-rank percentiles.
- Browser automation uses Ego Browser only.
- This plan produces PR C only. Evidence-selected latency changes belong to a later PR D plan.

---

### Task 1: Browser double-metric startup trace runtime

**Files:**
- Modify: `packages/happy-app/sources/sync/sessionStartupTrace.ts`
- Create: `packages/happy-app/sources/sync/sessionStartupTraceRuntime.ts`
- Create: `packages/happy-app/sources/sync/sessionStartupTraceRuntime.test.ts`
- Modify: `packages/happy-app/sources/sync/sessionStartupTrace.test.ts`
- Create: `packages/happy-app/sources/sync/sessionCriticalPathProbeBridge.ts`
- Create: `packages/happy-app/sources/sync/sessionCriticalPathProbeBridge.test.ts`
- Modify: `packages/happy-app/sources/components/appRoot/appRootFonts.ts`
- Create: `packages/happy-app/sources/components/appRoot/appRootFonts.test.ts`
- Modify: `packages/happy-app/sources/components/appRoot/AuthenticatedRootLayout.tsx`
- Modify: `packages/happy-app/sources/components/appRoot/AuthenticatedRootLayout.test.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.hydration.test.tsx`
- Modify: `packages/happy-app/sources/hooks/useSpawnSession.ts`
- Modify: `packages/happy-app/sources/hooks/useSpawnSession.test.tsx`
- Modify: `packages/happy-app/sources/sync/sync.ts`
- Modify: `packages/happy-app/sources/sync/sync.messageVisibility.test.ts`

**Interfaces:**
- Consumes: the current `traceId`, `sessionId`, encrypted session events, and `traceStartup()` serializer.
- Produces:

```ts
export type WebStartupTraceHandle = Readonly<{ traceId: string; startedAt: number }>;

export interface WebStartupTraceRuntime {
  begin(traceId: string, startedAt: number): WebStartupTraceHandle;
  bindSession(handle: WebStartupTraceHandle, sessionId: string): boolean;
  mark(handle: WebStartupTraceHandle, stage: WebStartupStage, now?: number): boolean;
  markSessionStage(
    sessionId: string,
    stage: 'web.processor.ready_received' | 'web.first_agent_event_received' | 'web.turn.completed',
    now?: number,
  ): boolean;
  finish(handle: WebStartupTraceHandle): void;
  cancel(handle: WebStartupTraceHandle, errorCode: string): void;
}

export const sessionStartupTraceRuntime: WebStartupTraceRuntime;
```

The runtime stores only in-memory handles. The Sync layer classifies already-decrypted normalized messages and calls `markSessionStage`: `{ type: 'ready' }` maps to processor-ready, the first real agent output maps to first-agent-event, and the existing terminal lifecycle event maps to turn-completed. Each stage is idempotent. The session binding remains through turn completion and is then removed; timeout, cancel, and explicit finish also remove it. Same-session stale handles cannot consume a newer handle's event.

`sessionCriticalPathProbeBridge.ts` is the only optional application-to-document-probe boundary. It feature-detects the document-start probe and invokes fixed methods without reading browser storage or response data:

```ts
export type SessionCriticalPathAppStage =
  | 'web.root.module_ready'
  | 'web.fonts.critical_ready'
  | 'web.crypto.ready'
  | 'web.credentials.ready'
  | 'web.route.mounted'
  | 'web.session.snapshot_started'
  | 'web.session.snapshot_completed'
  | 'web.messages.latest_started'
  | 'web.messages.latest_completed'
  | 'web.session.store_committed'
  | 'web.session.latest_message_painted'
  | 'web.session.route_painted';

export function markSessionCriticalPathAppStage(stage: SessionCriticalPathAppStage): boolean;
```

- [ ] **Step 1: Write RED tests for stage sanitation and memory-only lifecycle**

Add literal expectations for the new fixed stages and test a real runtime instance:

```ts
const first = runtime.begin(TRACE_A, 100);
expect(runtime.bindSession(first, 'session-a')).toBe(true);
expect(runtime.markSessionStage('session-a', 'web.processor.ready_received', 350)).toBe(true);
expect(writer).toHaveBeenCalledWith(expect.objectContaining({
  traceId: TRACE_A,
  stage: 'web.processor.ready_received',
  duration: 250,
}));
expect(runtime.markSessionStage('session-a', 'web.processor.ready_received', 400)).toBe(false);
```

Cover stale same-session handles, malformed events, cancel/finish cleanup, and throwing writers. Name the production break each case catches.

Add bridge tests with a real fake `globalThis.__happySessionCriticalPathProbe` object. Unknown/missing/throwing probe methods return false and never affect rendering. `appRootFonts.test.ts` and `AuthenticatedRootLayout.test.tsx` prove the fixed boot milestones occur in dependency order without asserting on private implementation objects.

- [ ] **Step 2: Run RED tests**

Run:

```bash
pnpm --filter happy-app exec vitest run \
  sources/sync/sessionStartupTrace.test.ts \
  sources/sync/sessionStartupTraceRuntime.test.ts \
  sources/sync/sessionCriticalPathProbeBridge.test.ts \
  sources/components/appRoot/appRootFonts.test.ts \
  sources/components/appRoot/AuthenticatedRootLayout.test.tsx
```

Expected: FAIL because the runtime and the new allowlisted stages do not exist.

- [ ] **Step 3: Implement the minimal runtime and fixed stage extension**

Use private maps keyed by handle identity and session ID. Use `performance.now()` on Web with `Date.now()` as a safe fallback. Keep `traceStartup()` as the only serialization/writer boundary. Do not export internal maps or add storage persistence.

- [ ] **Step 4: Write RED integration tests for spawn and encrypted ready events**

In `useSpawnSession.test.tsx`, prove one handle is created on click and bound only after the RPC supplies a session ID. In `sync.messageVisibility.test.ts`, send a real normalized session-ready message through the existing realtime update path and assert the bound browser trace marks processor-ready once.

Delay injection must prove:

```ts
expect(navigateToSession).toHaveBeenCalled();
expect(markedStages).not.toContain('web.processor.ready_received');
readyHandler();
expect(markedStages).toContain('web.processor.ready_received');
```

Expected RED: navigation completes, but the ready event has no trace binding or milestone.

- [ ] **Step 5: Connect spawn, route-paint, ready-event, and cleanup boundaries**

Bind the singleton runtime when `onRegistered(sessionId)` fires. Mark `web.session.navigated` at the existing navigation call and add `web.session.route_painted` only from a post-layout/browser-paint callback on the matching session route. Emit root/font/crypto/credentials/route, target snapshot start/completion, latest-message request start/completion, store commit, and latest-paint app stages through the probe bridge at their actual boundaries. Feed only already-decrypted, normalized ready/agent/turn-completion semantics into `markSessionStage`. Cancel on terminal spawn failure; retain the binding across navigation through turn completion or bounded trace expiry.

- [ ] **Step 6: Run GREEN tests and the existing probe tests**

```bash
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

Expected: all tests PASS with no unhandled rejection.

- [ ] **Step 7: Commit**

```bash
git add packages/happy-app/sources/sync/sessionStartupTrace.ts \
  packages/happy-app/sources/sync/sessionStartupTraceRuntime.ts \
  packages/happy-app/sources/sync/sessionStartupTraceRuntime.test.ts \
  packages/happy-app/sources/sync/sessionStartupTrace.test.ts \
  packages/happy-app/sources/sync/sessionCriticalPathProbeBridge.ts \
  packages/happy-app/sources/sync/sessionCriticalPathProbeBridge.test.ts \
  packages/happy-app/sources/components/appRoot/appRootFonts.ts \
  packages/happy-app/sources/components/appRoot/appRootFonts.test.ts \
  packages/happy-app/sources/components/appRoot/AuthenticatedRootLayout.tsx \
  packages/happy-app/sources/components/appRoot/AuthenticatedRootLayout.test.tsx \
  packages/happy-app/sources/-session/SessionView.tsx \
  packages/happy-app/sources/-session/SessionView.hydration.test.tsx \
  packages/happy-app/sources/hooks/useSpawnSession.ts \
  packages/happy-app/sources/hooks/useSpawnSession.test.tsx \
  packages/happy-app/sources/sync/sync.ts \
  packages/happy-app/sources/sync/sync.messageVisibility.test.ts
git commit -m "feat(observability): measure processor-ready startup"
```

---

### Task 2: Server, daemon, and worker local startup spans

**Files:**
- Modify: `packages/happy-server/sources/app/api/socket/rpcHandler.ts`
- Modify: `packages/happy-server/sources/app/api/socket/rpcHandler.spec.ts`
- Modify: `packages/happy-cli/src/daemon/sessionStartupTrace.ts`
- Modify: `packages/happy-cli/src/daemon/run.ts`
- Modify: `packages/happy-cli/src/daemon/run.sessionStartupTrace.test.ts`
- Modify: `packages/happy-cli/src/api/sessionStartupTrace.ts`
- Modify: `packages/happy-cli/src/api/apiSession.ts`
- Modify: `packages/happy-cli/src/api/apiSession.test.ts`
- Modify: `packages/happy-cli/src/claude/runClaude.ts`
- Modify: `packages/happy-cli/src/claude/runClaude.test.ts`
- Modify: `packages/happy-cli/src/codex/runCodex.ts`
- Create: `packages/happy-cli/src/codex/runCodex.startupTrace.test.ts`
- Modify: `packages/happy-cli/src/agent/acp/runAcp.ts`
- Modify: `packages/happy-cli/src/agent/acp/runAcp.test.ts`

**Interfaces:**
- Consumes: the existing validated `traceId` environment handoff and fixed-schema startup writers.
- Produces component-local `duration`/`spanDuration` events for `daemon.spawn.request_received`, `worker.entry.started`, `worker.auth.ready`, `worker.machine.ready`, `worker.processor.starting`, and `worker.processor.ready`.
- `WorkerSessionStartupLifecycle.processorReady(sessionId, machineId?)` is idempotent and may run only after the real message-consumption handler is registered.

- [ ] **Step 1: Write RED span-order and redaction tests**

Use deterministic clocks and literal event arrays. Example:

```ts
const lifecycle = new WorkerSessionStartupLifecycle(TRACE_ID, writer, tick);
lifecycle.entryStarted();
lifecycle.authReady();
lifecycle.bindCreatedSession('session-a');
lifecycle.processorStarting('session-a');
lifecycle.processorReady('session-a');
expect(stages(writer)).toEqual([
  'worker.entry.started',
  'worker.auth.ready',
  'worker.session.created',
  'worker.processor.starting',
  'worker.processor.ready',
]);
```

Assert the events exclude command, directory, environment, prompt, raw error, token, and agent-specific payload fields. Assert wrong-session and duplicate ready calls return false.

- [ ] **Step 2: Run RED server/CLI tests**

```bash
pnpm --filter happy-server-self-host exec vitest run sources/app/api/socket/rpcHandler.spec.ts
pnpm --dir packages/happy-cli exec vitest run --project unit \
  src/daemon/run.sessionStartupTrace.test.ts \
  src/api/apiSession.test.ts \
  src/claude/runClaude.test.ts \
  src/codex/runCodex.startupTrace.test.ts \
  src/agent/acp/runAcp.test.ts
```

Expected: FAIL on missing stages and missing `processorReady()` semantics.

- [ ] **Step 3: Implement component-local span helpers**

Keep one component-local monotonic origin in each lifecycle. Serialize only the allowlisted fields. Existing wall-clock `timestamp` remains diagnostic and is not used for cross-machine subtraction. Logger failures remain swallowed.

- [ ] **Step 4: Instrument exact semantic boundaries**

- Daemon: record request receipt at the beginning of the registered spawn handler and child start immediately after a real PID exists.
- Worker: record entry before auth/setup, auth-ready after usable credentials, machine-ready after identity is available, processor-starting immediately before backend/client initialization.
- Claude: call processor-ready after the remote message handler is installed.
- Codex: call processor-ready only after app-server connection, thread availability, and message handling are installed.
- ACP: call processor-ready after `backend.startSession()` succeeds and the message handler is installed.
- Keep the existing encrypted `{ type: 'ready' }` event at the same or later semantic boundary; move it if an adapter currently emits it too early.

- [ ] **Step 5: Run GREEN tests, typechecks, and CLI build**

```bash
pnpm --filter happy-server-self-host exec vitest run sources/app/api/socket/rpcHandler.spec.ts
pnpm --filter happy-server-self-host run typecheck
pnpm --dir packages/happy-cli exec vitest run --project unit \
  src/daemon/run.sessionStartupTrace.test.ts \
  src/api/apiSession.test.ts \
  src/claude/runClaude.test.ts \
  src/codex/runCodex.startupTrace.test.ts \
  src/agent/acp/runAcp.test.ts
pnpm --dir packages/happy-cli run build
```

Expected: all tests and typechecks PASS; only existing pkgroll bin/empty-chunk warnings are allowed.

- [ ] **Step 6: Commit**

```bash
git add packages/happy-server/sources/app/api/socket/rpcHandler.ts \
  packages/happy-server/sources/app/api/socket/rpcHandler.spec.ts \
  packages/happy-cli/src/daemon/sessionStartupTrace.ts \
  packages/happy-cli/src/daemon/run.ts \
  packages/happy-cli/src/daemon/run.sessionStartupTrace.test.ts \
  packages/happy-cli/src/api/sessionStartupTrace.ts \
  packages/happy-cli/src/api/apiSession.ts \
  packages/happy-cli/src/api/apiSession.test.ts \
  packages/happy-cli/src/claude/runClaude.ts \
  packages/happy-cli/src/claude/runClaude.test.ts \
  packages/happy-cli/src/codex/runCodex.ts \
  packages/happy-cli/src/codex/runCodex.startupTrace.test.ts \
  packages/happy-cli/src/agent/acp/runAcp.ts \
  packages/happy-cli/src/agent/acp/runAcp.test.ts
git commit -m "feat(observability): trace processor startup spans"
```

---

### Task 3: Route-opening ownership and latest-page coordination

**Files:**
- Create: `packages/happy-app/sources/sync/sessionRouteOwnership.ts`
- Create: `packages/happy-app/sources/sync/sessionRouteOwnership.test.ts`
- Modify: `packages/happy-app/sources/sync/sync.ts`
- Modify: `packages/happy-app/sources/sync/sync.messageVisibility.test.ts`
- Modify: `packages/happy-app/sources/sync/sessionBootstrap.test.ts`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Modify: `packages/happy-app/sources/-session/SessionView.hydration.test.tsx`

**Interfaces:**
- Produces:

```ts
export type SessionRouteOwner = Readonly<{
  sessionId: string;
  ownerEpoch: number;
  phase: 'opening' | 'interactive';
}>;

export class SessionRouteOwnership {
  enter(sessionId: string): SessionRouteOwner;
  promote(owner: SessionRouteOwner): SessionRouteOwner | null;
  current(): SessionRouteOwner | null;
  owns(owner: SessionRouteOwner): boolean;
  ownsSession(sessionId: string): boolean;
  leave(owner: SessionRouteOwner): boolean;
}
```

- `sync.beginSessionRoute(sessionId)` returns an owner used by `openSession(sessionId, owner)`.
- `sync.promoteSessionRoute(owner)` marks the route interactive without changing read state.
- `sync.leaveSessionRoute(owner)` uses identity-checked cleanup.

- [ ] **Step 1: Write RED ownership tests**

Test A -> B switching and same-ID remount:

```ts
const oldA = owners.enter('a');
const b = owners.enter('b');
expect(owners.leave(oldA)).toBe(false);
expect(owners.current()).toBe(b);

const oldB = b;
const newB = owners.enter('b');
expect(owners.leave(oldB)).toBe(false);
expect(owners.current()).toBe(newB);
```

Expected RED: class and APIs do not exist.

- [ ] **Step 2: Implement the ownership class and verify unit GREEN**

```bash
pnpm --filter happy-app exec vitest run sources/sync/sessionRouteOwnership.test.ts
```

- [ ] **Step 3: Write RED realtime/latest-page interleaving tests**

Use real Sync, storage, and encryption composition. Hold latest-page decryption, inject a nonconsecutive realtime message before ready, then release the competing foreground catch-up. Assert:

```ts
expect(openingResult).toBe('ready');
expect(latestRequestCount).toBe(1);
expect(storage.getState().sessionMessages[id].isLoaded).toBe(true);
expect(storage.getState().sessionMessages[id].messages).toContainEqual(
  expect.objectContaining({ id: 'latest-visible-message' }),
);
```

Do not preset `currentViewingSessionId`. Add the reverse completion order and an old-owner cleanup case. Current code must fail because realtime sees the opening route as background or because `openSession()` ignores a superseded latest-page apply.

- [ ] **Step 4: Connect SessionView and Sync ownership**

Acquire ownership before calling `openSession`. Realtime foreground checks use route ownership as well as interactive viewing. Promote only after the latest page has committed and the loaded component is mounted; only then call the existing viewing/read setter. Await a superseding foreground message operation before returning ready. Bounded retry remains for network failure, not lease self-cancellation.

- [ ] **Step 5: Run GREEN regression set**

```bash
pnpm --filter happy-app exec vitest run --maxWorkers=2 \
  sources/sync/sessionRouteOwnership.test.ts \
  sources/sync/sync.messageVisibility.test.ts \
  sources/sync/sessionBootstrap.test.ts \
  sources/-session/SessionView.hydration.test.tsx \
  sources/-session/SessionView.agentSpace.test.tsx
pnpm --filter happy-app run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/happy-app/sources/sync/sessionRouteOwnership.ts \
  packages/happy-app/sources/sync/sessionRouteOwnership.test.ts \
  packages/happy-app/sources/sync/sync.ts \
  packages/happy-app/sources/sync/sync.messageVisibility.test.ts \
  packages/happy-app/sources/sync/sessionBootstrap.test.ts \
  packages/happy-app/sources/-session/SessionView.tsx \
  packages/happy-app/sources/-session/SessionView.hydration.test.tsx
git commit -m "fix(sync): retain opening session ownership"
```

---

### Task 4: Contiguous older-message frontier

**Files:**
- Create: `packages/happy-app/sources/sync/sessionMessageFrontier.ts`
- Create: `packages/happy-app/sources/sync/sessionMessageFrontier.test.ts`
- Modify: `packages/happy-app/sources/sync/sync.ts`
- Modify: `packages/happy-app/sources/sync/sessionBootstrap.test.ts`
- Modify: `packages/happy-app/sources/sync/sync.messageVisibility.test.ts`
- Modify: `packages/happy-app/sources/sync/sync.sessionWriters.test.ts`

**Interfaces:**
- Produces:

```ts
export type MessageRange = Readonly<{ minSeq: number; maxSeq: number }>;
export type MessageRangeFrontier = Readonly<{
  latestSeq: number | null;
  olderBeforeSeq: number | null;
  hasMoreOlder: boolean;
}>;

export function applyLatestRange(
  current: MessageRangeFrontier | undefined,
  page: MessageRange | null,
  hasMore: boolean,
): MessageRangeFrontier;

export function applyOlderRange(
  current: MessageRangeFrontier,
  page: MessageRange | null,
  hasMore: boolean,
  cachedSeqs: readonly number[],
): MessageRangeFrontier;
```

- Sync stores one frontier per retained session instead of treating the cache's absolute minimum as the next backward cursor.

- [ ] **Step 1: Write RED frontier table tests**

Literal table cases include empty, adjacent, overlap, and gap:

```ts
expect(applyLatestRange(undefined, { minSeq: 151, maxSeq: 250 }, true)).toEqual({
  latestSeq: 250,
  olderBeforeSeq: 151,
  hasMoreOlder: true,
});
expect(applyOlderRange(
  { latestSeq: 250, olderBeforeSeq: 151, hasMoreOlder: true },
  { minSeq: 51, maxSeq: 150 },
  true,
  seqs(1, 100),
)).toEqual({ latestSeq: 250, olderBeforeSeq: 1, hasMoreOlder: false });
```

The expected frontier is hand-derived; do not compute it with the production helper.

- [ ] **Step 2: Run RED and implement the pure frontier**

```bash
pnpm --filter happy-app exec vitest run sources/sync/sessionMessageFrontier.test.ts
```

Expected RED before implementation, then PASS after the minimal pure helper.

- [ ] **Step 3: Write RED real Sync range-reachability test**

Seed actual cached API messages `1..100`, apply latest API page `151..250`, invoke `loadOlderMessages`, and assert the request URL contains `before_seq=151`. Return `51..150`, then assert normalized IDs `1..250` are reachable once each. Continue until `hasMore=false` and cover a superseded/evicted older response.

Expected RED: older API is never called because the current cursor is `1`.

- [ ] **Step 4: Replace cursor maps with frontier state**

Use the frontier for latest, forward, and older operations. Keep message storage deduplicated. Release the frontier with the existing message-cache lifecycle. Never advance across an unobserved gap. Preserve the latest sequence used by realtime forward sync.

- [ ] **Step 5: Run GREEN regression set**

```bash
pnpm --filter happy-app exec vitest run --maxWorkers=2 \
  sources/sync/sessionMessageFrontier.test.ts \
  sources/sync/sessionBootstrap.test.ts \
  sources/sync/sync.messageVisibility.test.ts \
  sources/sync/sync.sessionWriters.test.ts
pnpm --filter happy-app run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/happy-app/sources/sync/sessionMessageFrontier.ts \
  packages/happy-app/sources/sync/sessionMessageFrontier.test.ts \
  packages/happy-app/sources/sync/sync.ts \
  packages/happy-app/sources/sync/sessionBootstrap.test.ts \
  packages/happy-app/sources/sync/sync.messageVisibility.test.ts \
  packages/happy-app/sources/sync/sync.sessionWriters.test.ts
git commit -m "fix(sync): preserve contiguous message frontiers"
```

---

### Task 5: Attachment picker lifecycle generations

**Files:**
- Create: `packages/happy-app/sources/hooks/attachmentSelectionGeneration.ts`
- Create: `packages/happy-app/sources/hooks/attachmentSelectionGeneration.test.ts`
- Modify: `packages/happy-app/sources/hooks/useImagePicker.ts`
- Modify: `packages/happy-app/sources/hooks/useImagePicker.test.ts`
- Modify: `packages/happy-app/sources/sync/composeDraft.ts`
- Modify: `packages/happy-app/sources/components/ComposeHome.tsx`
- Modify: `packages/happy-app/sources/components/ComposeHome.test.tsx`

**Interfaces:**
- Produces:

```ts
export type AttachmentSelectionToken = Readonly<{
  instanceEpoch: number;
  draftEpoch: number;
  invalidationEpoch: number;
}>;

export interface AttachmentSelectionGuard {
  capture(): AttachmentSelectionToken;
  isCurrent(token: AttachmentSelectionToken): boolean;
  invalidate(): void;
  replaceDraft(draftEpoch: number): void;
  unmount(): void;
}
```

- `useImagePicker` accepts optional `selection.generation` with `currentDraftEpoch()` and `invalidate()` so external compose-draft reset participates in the same guard.

- [ ] **Step 1: Write RED pure generation tests**

Prove clear/unmount/draft replacement invalidate prior tokens, while two captures without invalidation remain valid. Implement the minimal guard only after observing the expected missing-symbol failure.

- [ ] **Step 2: Write RED hook tests using real external selection state**

Parameterize media and PDF paths:

```ts
const pending = deferred<DocumentPicker.DocumentPickerResult>();
pickerMock.mockReturnValueOnce(pending.promise);
let picking!: Promise<void>;
act(() => { picking = current!.pickMedia(); });
act(() => { current!.clearImages(); });
pending.resolve(validMediaResult);
await act(async () => { await picking; });
expect(realDraft().images).toEqual([]);
```

Add unmount + newer-instance data, external `clearComposeDraft()` while mounted, PDF stat delay, image normalization delay, and a positive pair of concurrently valid selections. Current media/PDF code must fail by repopulating the real draft.

- [ ] **Step 3: Implement the guard across every await boundary**

Capture before permission/picker work. Check after permission, picker return, normalization, thumbhash, PDF stat, and before the final functional setter. `clearImages`, unmount, external draft reset, and accepted-submit cleanup invalidate. Text edits do not affect attachment generation.

- [ ] **Step 4: Run GREEN hook and compose integration tests**

```bash
pnpm --filter happy-app exec vitest run \
  sources/hooks/attachmentSelectionGeneration.test.ts \
  sources/hooks/useImagePicker.test.ts \
  sources/components/ComposeHome.test.tsx
pnpm --filter happy-app run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/hooks/attachmentSelectionGeneration.ts \
  packages/happy-app/sources/hooks/attachmentSelectionGeneration.test.ts \
  packages/happy-app/sources/hooks/useImagePicker.ts \
  packages/happy-app/sources/hooks/useImagePicker.test.ts \
  packages/happy-app/sources/sync/composeDraft.ts \
  packages/happy-app/sources/components/ComposeHome.tsx \
  packages/happy-app/sources/components/ComposeHome.test.tsx
git commit -m "fix(app): discard stale attachment picker results"
```

---

### Task 6: Consumable PC Web history-scroll intent

**Files:**
- Create: `packages/happy-app/sources/components/sessionHistoryScrollIntent.ts`
- Create: `packages/happy-app/sources/components/sessionHistoryScrollIntent.test.ts`
- Modify: `packages/happy-app/sources/components/SessionHistoryList.tsx`
- Modify: `packages/happy-app/sources/components/SessionHistoryList.test.tsx`
- Modify: `packages/happy-app/e2e/web-session-history.spec.ts`

**Interfaces:**
- Produces:

```ts
export class SessionHistoryScrollIntent {
  noteNativeDrag(): void;
  noteWebScroll(offsetY: number): void;
  consumeAtEnd(): boolean;
}
```

`noteWebScroll` creates a new intent only when the offset changes because of a user scroll event; initial layout at offset zero creates none. Repeated end callbacks consume nothing until a new drag or changed Web scroll offset occurs.

- [ ] **Step 1: Write RED pure intent and component behavior tests**

Test initial end = false, Web scroll then end = true exactly once, second changed offset then end = true, and native drag parity. Component tests call the actual RN `onScroll` payload without `onScrollBeginDrag` and assert `sync.loadNextSessionHistoryPage` once.

Expected RED: Web scroll does not authorize loading.

- [ ] **Step 2: Implement intent and connect RN Web/native event paths**

Keep `onEndReached` as the only consumer. Do not call pagination directly from every scroll event. Preserve page/sidebar path readiness gates.

- [ ] **Step 3: Add the minimal Ego-compatible E2E case**

The spec must describe one wheel-to-end action and assert both a next-page request and new history rows. It must not use Playwright for production acceptance; the checked-in E2E documents the Case and local harness behavior, while final production execution uses Ego.

- [ ] **Step 4: Run GREEN tests and typecheck**

```bash
pnpm --filter happy-app exec vitest run \
  sources/components/sessionHistoryScrollIntent.test.ts \
  sources/components/SessionHistoryList.test.tsx
pnpm --filter happy-app run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/components/sessionHistoryScrollIntent.ts \
  packages/happy-app/sources/components/sessionHistoryScrollIntent.test.ts \
  packages/happy-app/sources/components/SessionHistoryList.tsx \
  packages/happy-app/sources/components/SessionHistoryList.test.tsx \
  packages/happy-app/e2e/web-session-history.spec.ts
git commit -m "fix(web): paginate history after wheel scroll"
```

---

### Task 7: Fail-closed attribution evaluator and PR C acceptance contract

**Files:**
- Modify: `packages/happy-app/scripts/check-session-critical-path.mjs`
- Modify: `packages/happy-app/scripts/check-session-critical-path.test.mjs`
- Modify: `docs/acceptance/session-critical-path/README.md`
- Create: `docs/acceptance/session-critical-path/phase-2-pr-c.md`

**Interfaces:**
- Consumes: fixed Web milestones from Task 1 and component-local stage names from Task 2.
- Produces a minimal evidence shape:

```ts
type Phase2CriticalPathEvidence = {
  resources: Array<{ name: string }>;
  samples: Array<{
    kind: 'deep-link' | 'spawn';
    cache: 'cold' | 'warm';
    retryCount: number;
    deepLinkInteractiveMs?: number;
    spawnRoutePaintMs?: number;
    processorReadyMs?: number;
  }>;
};
```

The evaluator reports `{ ok, sampleCount, deepLink, spawnRoutePaint, processorReady, legacySessionCalls }`, with each metric containing literal `min`, `p50`, `p95`, and `max` numbers. Unknown fields, missing mandatory stages, invalid sample combinations, a hidden retry, and exact-path `/v1/sessions` fail closed with fixed error codes.

- [ ] **Step 1: Write RED evaluator tests**

Use hand-written sample arrays to prove nearest-rank percentile behavior and boundaries:

```js
assert.deepEqual(evaluate(validSamples), {
  ok: true,
  sampleCount: validSamples.length,
  deepLink: { min: 1500, p50: 1800, p95: 3900, max: 3900 },
  spawnRoutePaint: { min: 5000, p50: 6500, p95: 9500, max: 9500 },
  processorReady: { min: 8000, p50: 9000, p95: 14000, max: 14000 },
  legacySessionCalls: 0,
});
```

Add failures at one millisecond above each threshold, insufficient cold/warm coverage, retries, malformed fields, and legacy resources.

- [ ] **Step 2: Run RED Node tests**

```bash
node --test packages/happy-app/scripts/check-session-critical-path.test.mjs
```

Expected: FAIL because Phase 2 samples and double metrics are not supported.

- [ ] **Step 3: Implement the minimal evaluator and update the document-start probe contract**

Keep the old mode backward compatible for Phase 1 evidence. Add an explicit Phase 2 mode rather than silently changing old JSON interpretation. Freeze each sample independently. The collector does not read response bodies, browser storage, credentials, or private IDs.

- [ ] **Step 4: Write the exact PR C acceptance procedure and Case table**

`phase-2-pr-c.md` records C1-C7 with `pass | fail | blocked | not-required`, evidence commands, and privacy rules. It explicitly states that PR C may fail final latency thresholds while still passing attribution completeness; PR D owns final latency success.

- [ ] **Step 5: Run full PR C verification**

```bash
pnpm --filter happy-app exec vitest run --maxWorkers=2 \
  sources/sync/sessionStartupTrace.test.ts \
  sources/sync/sessionStartupTraceRuntime.test.ts \
  sources/sync/sessionCriticalPathProbeBridge.test.ts \
  sources/components/appRoot/appRootFonts.test.ts \
  sources/components/appRoot/AuthenticatedRootLayout.test.tsx \
  sources/sync/sessionRouteOwnership.test.ts \
  sources/sync/sessionMessageFrontier.test.ts \
  sources/sync/sync.messageVisibility.test.ts \
  sources/sync/sessionBootstrap.test.ts \
  sources/sync/sync.sessionWriters.test.ts \
  sources/-session/SessionView.hydration.test.tsx \
  sources/-session/SessionView.agentSpace.test.tsx \
  sources/hooks/attachmentSelectionGeneration.test.ts \
  sources/hooks/useImagePicker.test.ts \
  sources/components/ComposeHome.test.tsx \
  sources/components/sessionHistoryScrollIntent.test.ts \
  sources/components/SessionHistoryList.test.tsx \
  sources/hooks/useSpawnSession.test.tsx
node --test packages/happy-app/scripts/check-session-critical-path.test.mjs
pnpm --filter happy-app run typecheck
pnpm --filter happy-server-self-host exec vitest run sources/app/api/socket/rpcHandler.spec.ts
pnpm --filter happy-server-self-host run typecheck
pnpm --dir packages/happy-cli exec vitest run --project unit \
  src/daemon/run.sessionStartupTrace.test.ts \
  src/api/apiSession.test.ts \
  src/claude/runClaude.test.ts \
  src/codex/runCodex.startupTrace.test.ts \
  src/agent/acp/runAcp.test.ts
pnpm --dir packages/happy-cli run build
git diff --check
```

Expected: every command exits 0; existing pkgroll bin/empty-chunk warnings may remain.

- [ ] **Step 6: Commit**

```bash
git add packages/happy-app/scripts/check-session-critical-path.mjs \
  packages/happy-app/scripts/check-session-critical-path.test.mjs \
  docs/acceptance/session-critical-path/README.md \
  docs/acceptance/session-critical-path/phase-2-pr-c.md
git commit -m "test(web): gate phase 2 startup attribution"
```

---

## Final branch gates

After Task 7, run an independent whole-branch review using the SDD review package. Resolve every Critical/Important finding through the bounded fix loop. Then execute production-like Ego Cases C1-C7, report every meaningful completed round with a screenshot, and close the task space. Do not push or create a PR until the user authorizes that external side effect.
