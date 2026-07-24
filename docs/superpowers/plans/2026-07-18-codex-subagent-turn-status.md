# Codex Sub-Agent Turn Status Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Codex sub-agent notifications from ending the root turn and show the root turn result until the next turn begins.

**Architecture:** Filter foreign-thread raw notifications at the Codex app-server boundary before they mutate root state. Preserve root lifecycle envelopes as invisible, sequence-ordered reducer state owned by `SessionMessages`, then feed that state into the existing composer status selector without changing server session schemas.

**Tech Stack:** TypeScript, Vitest, React Native/Expo, Zustand, Zod, unified session protocol.

**Spec:** `docs/superpowers/specs/2026-07-18-codex-subagent-turn-status-design.md`

---

## Chunk 1: Root-thread correctness and visible lifecycle state

### Task 1: Ignore foreign Codex thread notifications

**Files:**
- Modify: `packages/happy-cli/src/codex/codexAppServerClient.ts:329-490`
- Test: `packages/happy-cli/src/codex/codexAppServerClient.test.ts`

- [ ] **Step 1: Write the failing foreign-thread regression test**

Add a Vitest case beside the existing raw-notification tests. Start root thread
`thread-root`, start a pending root turn, then inject raw notifications whose
top-level `params.threadId` is `thread-child`:

```ts
pushJsonLine(stdout, {
    method: 'turn/started',
    params: {
        threadId: 'thread-child',
        turn: { id: 'turn-child', status: 'inProgress', items: [], error: null },
    },
});
pushJsonLine(stdout, {
    method: 'item/completed',
    params: {
        threadId: 'thread-child',
        turnId: 'turn-child',
        item: { type: 'agentMessage', id: 'child-final', text: 'Approved.', phase: 'final_answer' },
    },
});
```

Also inject child command start/end, file-change start/end, idle, and
`turn/completed`. Assert:

```ts
expect(client.threadId).toBe('thread-root');
expect(client.turnId).toBe('turn-root');
expect(events).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'agent_message', message: 'Approved.' }),
]));
expect(events.filter((event) => event.type === 'task_complete')).toHaveLength(0);
expect(events.filter((event) => event.type.startsWith('exec_command'))).toHaveLength(0);
expect(events.filter((event) => event.type.startsWith('patch_apply'))).toHaveLength(0);
```

Immediately after the child command/file-change start notifications, also
assert the root turn id is unchanged and no child call id appears in emitted
events or client bookkeeping. Then emit a root command/file-change pair to
prove the root bookkeeping still starts and completes independently.

Finally emit matching root final/completion events and await the pending root
turn; assert exactly one root completion. Add a separate compatibility case in
which a raw root event omits `threadId` and is still mapped.

- [ ] **Step 2: Run the CLI test and verify RED**

Run:

```bash
pnpm --filter ./packages/happy-cli exec vitest run --project unit src/codex/codexAppServerClient.test.ts
```

Expected: the foreign-thread test fails because `Approved.` and/or
`task_complete` is emitted and the root pending turn resolves too early.

- [ ] **Step 3: Implement the minimal notification guard**

Add a focused private predicate and call it at the start of raw notification
handling, after protocol selection but before any raw event mutates client
state:

```ts
private isForeignThreadNotification(params: unknown): boolean {
    if (!params || typeof params !== 'object') return false;
    const threadId = (params as { threadId?: unknown }).threadId;
    return typeof threadId === 'string'
        && this._threadId !== null
        && threadId !== this._threadId;
}
```

For a foreign thread, return `true` to mark the raw notification handled while
emitting nothing. Missing/non-string `threadId` retains compatibility behavior.

- [ ] **Step 4: Run the focused CLI test and verify GREEN**

Run the command from Step 2.

Expected: all `codexAppServerClient.test.ts` tests pass, including foreign and
missing-thread-id coverage.

- [ ] **Step 5: Commit Task 1**

```bash
git add packages/happy-cli/src/codex/codexAppServerClient.ts \
  packages/happy-cli/src/codex/codexAppServerClient.test.ts
git commit -m "fix(codex): ignore child thread completion events"
```

Use the repository-required Paws/Claude commit trailers.

### Task 2: Preserve ordered root lifecycle state in message storage

**Files:**
- Modify: `packages/happy-app/sources/sync/typesRaw.ts`
- Modify: `packages/happy-app/sources/sync/typesMessage.ts`
- Modify: `packages/happy-app/sources/sync/reducer/reducer.ts`
- Modify: `packages/happy-app/sources/sync/storage.ts`
- Modify: `packages/happy-app/sources/sync/sync.ts`
- Test: `packages/happy-app/sources/sync/typesRaw.spec.ts`
- Test: `packages/happy-app/sources/sync/reducer/reducer.spec.ts`
- Create: `packages/happy-app/sources/sync/storage.turnLifecycle.test.ts`
- Create: `packages/happy-app/sources/sync/messageNormalization.ts`
- Create: `packages/happy-app/sources/sync/messageNormalization.test.ts`
- Create: `packages/happy-app/sources/sync/sync.turnLifecycle.test.ts`

- [ ] **Step 1: Add failing normalization tests**

Define a normalized lifecycle status type:

```ts
export type RootTurnLifecycleStatus = 'running' | 'completed' | 'failed' | 'cancelled';
```

Extend `normalizeRawMessage` with an optional source sequence argument and add
tests that expect:

```ts
expect(normalizeRawMessage('start', null, 100, turnStartRaw, 41)).toMatchObject({
    role: 'event',
    content: { type: 'turn-lifecycle', status: 'running', seq: 41 },
});
expect(normalizeRawMessage('end', null, 100, turnEndRaw, 42)).toMatchObject({
    role: 'event',
    content: { type: 'turn-lifecycle', status: 'completed', seq: 42 },
});
```

Cover failed and cancelled end states. Existing malformed `turn-end` rejection
must remain.

- [ ] **Step 2: Run normalization tests and verify RED**

```bash
pnpm --filter happy-app exec vitest run sources/sync/typesRaw.spec.ts
```

Expected: turn-start is still `null`, turn-end is still generic `ready`, and
the optional sequence parameter/type does not exist.

- [ ] **Step 3: Implement lifecycle normalization**

Add `turn-lifecycle` to `AgentEvent`, carrying `status` and optional `seq`.
Normalize session `turn-start` and `turn-end` into invisible lifecycle events;
keep generic `ready` unchanged for legacy/voice inputs. Pass source sequence
through `normalizeRawMessage` without adding it to visible messages.

- [ ] **Step 4: Run normalization tests and verify GREEN**

Run the command from Step 2. Expected: all `typesRaw.spec.ts` tests pass.

- [ ] **Step 5: Add failing reducer ordering tests**

Add `rootTurnLifecycle` to `ReducerResult` and internal reducer state using a
small shape containing `status`, `seq`, `createdAt`, and fallback arrival order.
Before implementation, add tests for:

- completed, failed, and cancelled terminal states;
- start replacing a prior completed result;
- terminal accepted state setting `hasReadyEvent`;
- an older sequence arriving later not overwriting a newer state;
- equal timestamps resolving by sequence in both arrival orders;
- a newer sequenced `turn-start` rejecting a late older terminal marker;
- a sequenced record replacing an unsequenced record regardless of timestamp;
- a rejected stale terminal not setting `hasReadyEvent` again;
- unsequenced fallback ordering by timestamp then local arrival order.

- [ ] **Step 6: Run reducer tests and verify RED**

```bash
pnpm --filter happy-app exec vitest run sources/sync/reducer/reducer.spec.ts
```

Expected: lifecycle result/order assertions fail because the reducer currently
drops lifecycle markers.

- [ ] **Step 7: Implement the lifecycle reducer**

Consume `turn-lifecycle` events invisibly before visible-message conversion.
Use server `seq` as the primary watermark. Once a sequenced record has been
accepted, reject unsequenced records. For unsequenced-only histories, compare
`createdAt`, then reducer-local monotonic arrival order. Raise `hasReadyEvent`
only when a terminal lifecycle record is accepted.

- [ ] **Step 8: Run reducer tests and verify GREEN**

Run the command from Step 6. Expected: all reducer tests pass.

- [ ] **Step 9: Add failing storage/sync plumbing tests**

Test that:

- `SessionMessages` exposes the accepted lifecycle result;
- applying a server session snapshot does not remove it;
- initial/fetched messages pass each API message `seq` to normalization;
- realtime normalization passes `updateData.seq`;
- older-page replay cannot overwrite the live result.

Add a focused `storage.turnLifecycle.test.ts` that drives
`storage.getState().applyMessages` with an initial start/end batch, verifies the
terminal result is restored atomically, applies a subsequent session snapshot,
and verifies the reducer-owned result remains. Replay an older page afterward
and assert it cannot overwrite the live result.

Extract the repeated API/decrypted-message-to-normalizer call into the small
pure `messageNormalization.ts` helper. Test that it forwards the supplied API
`seq`, then use it for both initial/fetched batches and realtime updates.

Add `sync.turnLifecycle.test.ts` at the existing Sync test seam (mocking
`voiceHooks`) to apply an accepted terminal lifecycle and assert
`voiceHooks.onReady(sessionId)` fires once; replay the stale terminal and assert
it does not fire again. Keep this focused rather than constructing a broad
socket integration harness.

- [ ] **Step 10: Run storage/sync tests and verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run \
  sources/sync/storage.turnLifecycle.test.ts \
  sources/sync/messageNormalization.test.ts \
  sources/sync/sync.turnLifecycle.test.ts
```

Expected: lifecycle is absent from `SessionMessages` and normalization does not
receive sequence values.

- [ ] **Step 11: Implement storage/sync plumbing**

Keep lifecycle in `SessionMessages`/its reducer state. Extend
`useSessionMessages` to return it. In fetched batches, align decrypted messages
with their source API records and pass `messages[i].seq`; in realtime updates,
pass `updateData.seq`. Do not add fields to server `Session` schemas.

- [ ] **Step 12: Run focused App sync tests and verify GREEN**

Run normalization, reducer, and the selected storage/sync tests together.
Expected: all pass and terminal lifecycle still triggers the existing ready
callback exactly once when accepted.

- [ ] **Step 13: Commit Task 2**

```bash
git add packages/happy-app/sources/sync
git commit -m "feat(app): retain ordered root turn lifecycle"
```

Use the repository-required Paws/Claude commit trailers.

### Task 3: Show retained completion status in the composer

**Files:**
- Modify: `packages/happy-app/sources/utils/sessionUtils.ts`
- Modify: `packages/happy-app/sources/-session/SessionView.tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Create: `packages/happy-app/sources/utils/sessionUtils.test.ts`

- [ ] **Step 1: Write failing status-priority tests**

Extract or expose a pure status resolver so tests do not render React hooks.
Cover priority and labels:

```ts
expect(resolveSessionStatus(onlineIdleSession, 'completed', theme)).toMatchObject({
    state: 'completed',
    statusText: 'completed',
});
```

Also assert disconnected > permission > thinking > terminal result > waiting,
and cover failed/cancelled. Assert `running` does not show the previous terminal
label.

- [ ] **Step 2: Run status tests and verify RED**

```bash
pnpm --filter happy-app exec vitest run sources/utils/sessionUtils.test.ts
```

Expected: the resolver/state variants do not yet exist and idle remains online.

- [ ] **Step 3: Implement status selection and localization**

Keep the list-row `SessionState` unchanged and introduce a composer-specific
status state that adds `completed`, `failed`, and `cancelled`. Add
`status.taskCompleted`, `status.taskFailed`, and `status.taskCancelled` to the
default and all supported locale files. Keep permission ahead of thinking to
preserve existing behavior. Terminal states use non-pulsing semantic colors;
do not change the header presence chip.

Pass `rootTurnLifecycle?.status` from `useSessionMessages` in `SessionView` to
`useSessionStatus`. A lifecycle status of `running` delegates to existing
thinking/waiting behavior.

After adding the strings, dispatch the repository-required `i18n-translator`
agent to verify every supported language and the short composer-label context;
apply any required corrections before committing.

- [ ] **Step 4: Run status tests and verify GREEN**

Run the command from Step 2. Expected: all priority and label tests pass.

- [ ] **Step 5: Run combined focused App tests**

```bash
pnpm --filter happy-app exec vitest run \
  sources/sync/typesRaw.spec.ts \
  sources/sync/reducer/reducer.spec.ts \
  sources/utils/sessionUtils.test.ts
```

Include the selected storage/sync test file from Task 2. Expected: all pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add packages/happy-app/sources
git commit -m "feat(app): show completed root turn status"
```

Use the repository-required Paws/Claude commit trailers.

### Task 4: Final verification and PR preparation

**Files:**
- Verify all files changed since `main`

- [ ] **Step 1: Run focused tests**

Run the focused CLI and App commands from Tasks 1-3. Expected: zero failures.

- [ ] **Step 2: Run package typechecks**

```bash
pnpm --filter ./packages/happy-cli typecheck
pnpm --filter happy-app typecheck
```

Expected: both exit 0 with zero TypeScript errors.

- [ ] **Step 3: Check diff hygiene and branch state**

```bash
git diff --check main...HEAD
git status --short
git log --oneline main..HEAD
```

Expected: no whitespace errors, clean worktree, and only the design/plan plus
scoped implementation commits.

Also verify the protected root workspace both before implementation delivery
and after the PR is created:

```bash
git -C /Users/jacky/jacky-github/happy status --short --branch
test "$(git -C /Users/jacky/jacky-github/happy rev-parse HEAD)" = \
  "$(git -C /Users/jacky/jacky-github/happy rev-parse origin/main)"
```

Expected: root workspace is clean on `main` and exactly matches `origin/main`.

- [ ] **Step 4: Request independent final code review**

Review `main..HEAD` against the approved spec. Fix all Critical and Important
findings, rerun affected tests/typechecks, and request re-review until ready.

- [ ] **Step 5: Push and create the PR**

After verification and review, push `fix/codex-subagent-status` to `origin` and
create a PR targeting `main`. The PR must summarize root-thread filtering,
retained lifecycle UI, and exact verification commands. Do not merge or publish
an App/OTA release.
