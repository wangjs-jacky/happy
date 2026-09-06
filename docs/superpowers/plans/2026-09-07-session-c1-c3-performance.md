# Session C1–C3 Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make verified deep-link paint correctly attributable, paint a newly queued session before slow network revalidation completes, and remove the measured Codex worker static-import delay from the daemon spawn path.

**Architecture:** Preserve cache-first UI while splitting cached/local paint from verified-latest paint. A new session waits only for its encrypted-outbox receipt and local store projection before navigating; targeted route validation continues in the background with visible retry/error state. Daemon-started Codex uses a dedicated lightweight bundle entry that emits `worker.entry.started` before dynamically loading authentication and processor modules.

**Tech Stack:** TypeScript, React Native Web, Zustand, Vitest, Node.js ESM, pkgroll.

**Spec:** `docs/superpowers/specs/2026-09-05-session-critical-path-phase-2-design.md`

## Global Constraints

- Preserve end-to-end encryption, deletion generations, route ownership, outbox atomicity, reconnect recovery, and draft survival.
- Keep cache-first content visible; do not delay cached paint merely to satisfy the collector.
- `web.session.latest_message_painted` means the latest target state was verified and painted, so it must follow snapshot/latest/store completion for the same current route owner.
- New-session navigation remains after a successful `{ type: 'queued' }` local encrypted-outbox receipt; failed or cancelled queueing must not navigate.
- Background route validation retains bounded retry accounting and exposes retry/error state instead of fabricating success.
- Do not restore browser `GET /v1/sessions`, add a full-account bootstrap endpoint, or introduce daemon session preallocation.
- `worker.processor.ready` remains after the real message-consumption path is registered; never move it earlier.
- Evidence uses fixed stage names and durations only; never add prompts, bodies, credentials, paths, tokens, or private identifiers.
- Work only in `/Users/jacky/jacky-github/happy--session-c1-c3-performance`; keep the root repository clean `main`.

---

### Task 1: Make C1 verified paint readiness- and owner-aware

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Test: `packages/happy-app/sources/-session/SessionView.hydration.test.tsx`

**Interfaces:**
- Consumes: `sync.openSession(sessionId, owner)` resolving to `'ready' | 'not-found'`, `SessionRouteOwner.ownerEpoch`, and cache-first `canRenderCachedSession`.
- Produces: `SessionViewLoaded` prop `verifiedRouteOwnerEpoch: number | null`; non-null is the only authorization for `web.session.latest_message_painted`.
- Preserves: `web.session.route_painted` remains a separate navigation/display milestone.

- [ ] **Step 1: Add a RED cached-before-revalidation regression**

Add a test whose break is “a cached mount emits verified latest paint while `openSession()` is pending.” Seed a loaded cached message, keep `openSession` deferred, mount the real `SessionView`, assert cached content is visible, run queued frames, and assert the real probe's `markFreshLatestMessageComplete` has not run.

```ts
expect(renderer.root.findAllByProps({ testID: 'session-loading' })).toHaveLength(0);
runAllFrames();
expect(markFreshLatestMessageComplete).not.toHaveBeenCalled();
```

- [ ] **Step 2: Add RED ownership, zero-delta, and stale-frame cases**

Add cases for: the current owner resolves ready with zero new messages and marks exactly once on the next frame; an abandoned A owner cannot mark after B mounts; a same-ID retry/remount cancels the old frame.

```ts
opening.resolve('ready');
await opening.promise;
runAllFrames();
expect(markFreshLatestMessageComplete).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Verify RED**

```bash
pnpm --filter happy-app exec vitest run sources/-session/SessionView.hydration.test.tsx
```

Expected: new cases fail because `SessionViewLoaded` currently marks from `isLoaded && messages.length > 0` alone.

- [ ] **Step 4: Implement current-owner readiness authorization**

In `SessionViewContent` derive:

```ts
const verifiedRouteOwnerEpoch = sessionResolution === 'ready'
    && routeOwner?.sessionId === sessionId
    ? routeOwner.ownerEpoch
    : null;
```

Pass it to `SessionViewLoaded`. Its verified-paint effect must require a non-null epoch, loaded content, Web, and `requestAnimationFrame`; include the epoch in dependencies and cancel the frame in cleanup. Do not require message count to change after readiness.

- [ ] **Step 5: Verify GREEN**

```bash
pnpm --filter happy-app exec vitest run sources/-session/SessionView.hydration.test.tsx sources/sync/sync.messageVisibility.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/happy-app/sources/-session/SessionView.tsx packages/happy-app/sources/-session/SessionView.hydration.test.tsx
git commit -m "fix(web): bind verified session paint to route readiness"
```

---

### Task 2: Add a local-receipt fast handoff for C2 route paint

**Files:**
- Modify: `packages/happy-app/sources/sync/sync.ts`
- Modify: `packages/happy-app/sources/hooks/useSpawnSession.ts`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Test: `packages/happy-app/sources/hooks/useSpawnSession.test.tsx`
- Test: `packages/happy-app/sources/-session/SessionView.hydration.test.tsx`
- Test: `packages/happy-app/sources/sync/sync.messageVisibility.test.ts`

**Interfaces:**
- Produces: `sync.awaitLocalMessageProjection(sessionId: string, localIds: readonly string[]): Promise<boolean>`; it waits only for accepted local normalized messages to enter the store and never waits for HTTP.
- Consumes: exact `LocalMessageQueueReceipt.localIds` from `sync.sendMessage`.
- Produces: route-paint authorization when the current route has renderable matching cached/local content or is verified ready.
- Preserves: Task 1 controls verified latest paint; `sync.openSession()` continues targeted validation and retry accounting in the background.

- [ ] **Step 1: Add a RED local projection contract test**

Queue a real text message, call the new method with receipt IDs, and assert it resolves true only after all IDs exist in the store. Add deletion and malformed-ID cases; they resolve false and never recreate a deleted cache.

```ts
const receipt = await sync.sendMessage('spawned-session', 'hello', { source: 'new_session' });
await expect(sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds)).resolves.toBe(true);
for (const id of receipt.localIds) {
    expect(storage.getState().sessionMessages[receipt.sessionId].messagesMap[id]).toBeDefined();
}
```

- [ ] **Step 2: Add RED spawn ordering tests**

In `useSpawnSession.test.tsx`, defer projection. Assert receipt → local projection → draft transfer → navigation. A false projection must enter the existing error/retry path without navigation or re-sending.

```ts
expect(order).toEqual(['receipt']);
projection.resolve(true);
await spawnPromise;
expect(order).toEqual(['receipt', 'projection', 'draft-transfer', 'navigate']);
expect(sync.sendMessage).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Add RED fast-paint and background-failure tests**

Seed newborn local content and keep `openSession` pending. After one frame, assert `web.session.route_painted` once, verified latest absent, and no full loading view. Then drive retry/error and assert cached content remains with a non-blocking `session-retrying-cached` or `session-load-error-cached` affordance.

```ts
expect(routePaint).toHaveBeenCalledTimes(1);
expect(verifiedLatestPaint).not.toHaveBeenCalled();
expect(renderer.root.findAllByProps({ testID: 'session-loading' })).toHaveLength(0);
expect(renderer.root.findByProps({ testID: 'session-load-error-cached' })).toBeTruthy();
```

- [ ] **Step 4: Verify RED**

```bash
pnpm --filter happy-app exec vitest run sources/hooks/useSpawnSession.test.tsx sources/-session/SessionView.hydration.test.tsx sources/sync/sync.messageVisibility.test.ts
```

- [ ] **Step 5: Implement the local-only projection barrier**

Use the existing per-session message lock/queue. Await queued reducer work without starting `fetchMessages`, `invalidateAndAwait`, or HTTP. Re-check the session, cache generation, and every literal receipt ID after the barrier; return false on invalidation/deletion. Initialize/capture the generation at accepted outbox commit if queue scheduling currently creates it too late.

```ts
public awaitLocalMessageProjection = async (
    sessionId: string,
    localIds: readonly string[],
): Promise<boolean> => {
    if (localIds.length === 0) return false;
    const generation = this.sessionMessageCacheGenerations.get(sessionId);
    await this.getSessionMessageLock(sessionId).inLock(async () => undefined);
    const state = storage.getState();
    const messages = state.sessionMessages[sessionId]?.messagesMap;
    return !!state.sessions[sessionId]
        && this.sessionMessageCacheGenerations.get(sessionId) === generation
        && !!messages
        && localIds.every((id) => !!messages[id]);
};
```

- [ ] **Step 6: Await projection before navigation**

Immediately after validating the receipt in `finishPending`, await `sync.awaitLocalMessageProjection(receipt.sessionId, receipt.localIds)`. On false, throw a fixed local error and keep pending retry ownership. Do not call `sendMessage` again during hydration retry after `pending.queued` is true.

- [ ] **Step 7: Paint local content independently of verification**

Schedule the route-paint frame when the matching owner has renderable cached/local content or is ready. Key and cancel by session ID and owner epoch. Keep Task 1's verified effect unchanged. Render a compact cached-content retry/error affordance; its retry action increments `retryGeneration` without replacing the local message tree.

- [ ] **Step 8: Verify GREEN and message integrity**

```bash
pnpm --filter happy-app exec vitest run sources/hooks/useSpawnSession.test.tsx sources/-session/SessionView.hydration.test.tsx sources/sync/sync.messageVisibility.test.ts sources/sync/sync.sessionWriters.test.ts
```

Expected: one navigation, one local accepted message, early route paint, network-gated verified paint, visible background failure, and existing coordination retry accounting.

- [ ] **Step 9: Commit**

```bash
git add packages/happy-app/sources/sync/sync.ts packages/happy-app/sources/hooks/useSpawnSession.ts packages/happy-app/sources/-session/SessionView.tsx packages/happy-app/sources/hooks/useSpawnSession.test.tsx packages/happy-app/sources/-session/SessionView.hydration.test.tsx packages/happy-app/sources/sync/sync.messageVisibility.test.ts
git commit -m "perf(web): paint spawned sessions from local receipt"
```

---

### Task 3: Bypass the heavy CLI index for daemon-started Codex workers

**Files:**
- Create: `packages/happy-cli/src/codexWorkerEntry.ts`
- Modify: `packages/happy-cli/src/commands/codexCommand.ts`
- Modify: `packages/happy-cli/src/api/sessionStartupTrace.ts`
- Modify: `packages/happy-cli/src/utils/spawnHappyCLI.ts`
- Modify: `packages/happy-cli/src/daemon/run.ts`
- Modify: `packages/happy-cli/package.json`
- Test: `packages/happy-cli/src/commands/codexCommand.test.ts`
- Test: `packages/happy-cli/src/daemon/run.sessionStartupTrace.test.ts`
- Test: `packages/happy-cli/src/api/sessionStartupTrace.test.ts`
- Test: `packages/happy-cli/src/build/atomicBuild.test.ts`

**Interfaces:**
- Produces internal ESM entry: `./internal/codex-worker` → `./dist/codexWorkerEntry.mjs`.
- Produces: `traceWorkerAuthentication(authenticate, startupLifecycle?)`; supplied lifecycle is reused and no second trace is created.
- Produces: `spawnHappyCLI(args, { entrypoint?: 'main' | 'codex-worker' })`; default is `main`.
- Consumes: daemon's selected agent; only daemon Codex chooses `codex-worker`.
- Preserves: terminal `happy codex`, non-Codex agents, reconnect environment, webhook/session creation, and true processor-ready semantics.

- [ ] **Step 1: Add RED lifecycle reuse coverage**

```ts
const lifecycle = createWorkerSessionStartupLifecycleFromEnvironment(env);
const result = await traceWorkerAuthentication(authenticate, lifecycle);
expect(result.startupLifecycle).toBe(lifecycle);
expect(stages).toEqual(['worker.entry.started', 'worker.auth.ready', 'worker.machine.ready']);
```

- [ ] **Step 2: Add RED daemon entry selection coverage**

A Codex spawn expects `dist/codexWorkerEntry.mjs`; Claude/ACP and generic calls still expect `dist/index.mjs`. All original args/environment, including `--started-by daemon` and trace ID, remain unchanged.

- [ ] **Step 3: Add RED loader-ordering coverage**

Extract real orchestration `runCodexWorkerCommand(args, { startupLifecycle, loadCommandDependencies? })`. An injected loader records order; assert lifecycle entry exists before the heavy loader executes. Tests assert orchestrator behavior, not mere mock existence.

- [ ] **Step 4: Add RED atomic-build output coverage**

Update the build fixture's manifest with the internal worker export and assert `collectDistOutputs()` includes `index.mjs` and `codexWorkerEntry.mjs`, preventing a release that references an unpublished artifact.

- [ ] **Step 5: Verify RED**

```bash
env -u HAPPY_CODEX_PATH pnpm --filter @wangjs-jacky/paws exec vitest run --project unit src/api/sessionStartupTrace.test.ts src/commands/codexCommand.test.ts src/daemon/run.sessionStartupTrace.test.ts src/build/atomicBuild.test.ts
```

- [ ] **Step 6: Implement lightweight entry and lazy dependencies**

`codexWorkerEntry.ts` may statically import only Node built-ins and the small lifecycle module. Emit entry before dynamic import:

```ts
const startupLifecycle = createWorkerSessionStartupLifecycleFromEnvironment();
const { runCodexWorkerCommand } = await import('./commands/codexCommand.js');
await runCodexWorkerCommand(process.argv.slice(2), { startupLifecycle });
```

Move imports of `ui/auth`, `codex/runCodex`, daemon discovery, install prompts, and usage collection behind `loadCommandDependencies()`. Keep parsing synchronous and side-effect free. Normal `handleCodexCommand(args)` delegates without a supplied lifecycle.

- [ ] **Step 7: Route only daemon Codex to the artifact**

Map the explicit spawn option to an exact filename under package `dist`. Daemon selects it from its trusted agent selection, not arbitrary user arguments. Do not change stable daemon launch itself.

- [ ] **Step 8: Publish and build the internal artifact**

Add import/require/type entries mirroring existing package exports so pkgroll and atomic promotion include the artifact.

```bash
env -u HAPPY_CODEX_PATH pnpm --filter @wangjs-jacky/paws run build
test -s packages/happy-cli/dist/codexWorkerEntry.mjs
```

- [ ] **Step 9: Verify GREEN and readiness semantics**

```bash
env -u HAPPY_CODEX_PATH pnpm --filter @wangjs-jacky/paws exec vitest run --project unit src/api/sessionStartupTrace.test.ts src/commands/codexCommand.test.ts src/daemon/run.sessionStartupTrace.test.ts src/codex/runCodex.startupTrace.test.ts src/build/atomicBuild.test.ts
env -u HAPPY_CODEX_PATH pnpm --filter @wangjs-jacky/paws run build
```

The dedicated entry must materially reduce a same-machine sanitized `child_started → worker.entry.started` comparison. If it does not, report the measured module graph rather than claiming C3 improvement.

- [ ] **Step 10: Commit**

```bash
git add packages/happy-cli/src/codexWorkerEntry.ts packages/happy-cli/src/commands/codexCommand.ts packages/happy-cli/src/api/sessionStartupTrace.ts packages/happy-cli/src/utils/spawnHappyCLI.ts packages/happy-cli/src/daemon/run.ts packages/happy-cli/package.json packages/happy-cli/src/commands/codexCommand.test.ts packages/happy-cli/src/daemon/run.sessionStartupTrace.test.ts packages/happy-cli/src/api/sessionStartupTrace.test.ts packages/happy-cli/src/build/atomicBuild.test.ts
git commit -m "perf(cli): add lightweight Codex worker entry"
```

---

### Task 4: Cross-package verification and acceptance preparation

**Files:**
- Modify only through a reviewed fix round if a directly failing regression requires it.
- Record sanitized measurements in the SDD workspace, not tracked source.

**Interfaces:**
- Consumes: Task 1 verified paint, Task 2 local route paint, Task 3 lightweight entry.
- Produces: fresh Web/CLI test and build evidence plus a sanitized before/after table for Ego C1–C3.

- [ ] **Step 1: Run affected Web verification**

```bash
pnpm --filter happy-app exec vitest run sources/-session/SessionView.hydration.test.tsx sources/hooks/useSpawnSession.test.tsx sources/sync/sync.messageVisibility.test.ts sources/sync/sync.sessionWriters.test.ts sources/sync/sessionStartupTraceRuntime.test.ts
pnpm --filter happy-app run typecheck
```

- [ ] **Step 2: Run affected CLI verification and build**

```bash
env -u HAPPY_CODEX_PATH pnpm --filter @wangjs-jacky/paws exec vitest run --project unit src/api/sessionStartupTrace.test.ts src/commands/codexCommand.test.ts src/daemon/run.sessionStartupTrace.test.ts src/codex/runCodex.startupTrace.test.ts src/build/atomicBuild.test.ts
env -u HAPPY_CODEX_PATH pnpm --filter @wangjs-jacky/paws run build
```

- [ ] **Step 3: Re-check invariants**

```text
C1 cached content paints early; verified latest paints only after current-owner ready.
C2 queue receipt and local projection precede one navigation; route paints before network validation.
C2 background failure/retry is visible and counted; no duplicate/lost first message.
C3 worker entry is emitted before heavy Codex modules; processor ready is not moved earlier.
No full-account /v1/sessions startup call, no preallocation, no private trace fields.
```

- [ ] **Step 4: Commit only reviewed corrections**

Any production correction discovered here is implemented by the Task 4 worker, tested, independently re-reviewed, and committed with a scoped message. The controller does not silently amend prior work.

