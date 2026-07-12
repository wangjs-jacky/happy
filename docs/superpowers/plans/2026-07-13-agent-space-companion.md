# Agent Space Companion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entering a persisted Agent space immediately creates a blank isolated session, and Agent-space sessions replace the generic code capability hub with a space-specific companion panel whose first provider offers fixed health Tips and editable health quick actions.

**Architecture:** Add pure Agent-space identity/model functions first, then refactor the existing session spawn hook to expose a non-navigating core and build one entry coordinator on top. Keep `RightSwipePanelHost` as the shell, route its content from the current session's canonical Agent match, and make the companion panel consume a provider-neutral view model. Preserve existing ordinary-session behavior, existing spawn behavior, and the current global navigation-stack policy.

**Tech Stack:** React Native, Expo Router, TypeScript strict mode, Zustand/MMKV, Zod, React Native Reanimated, Unistyles, Vitest.

**Approved spec:** `docs/superpowers/specs/2026-07-13-agent-space-companion-design.md`

---

## File Map

### New files

- `packages/happy-app/sources/utils/agentSpaceIdentity.ts` — canonical path comparison, deterministic Agent/session matching, duplicate-path detection.
- `packages/happy-app/sources/utils/agentSpaceIdentity.test.ts` — table-driven identity and duplicate matching tests.
- `packages/happy-app/sources/components/agents/agentSpaceCompanionModel.ts` — provider-neutral panel model plus health/default providers.
- `packages/happy-app/sources/components/agents/agentSpaceCompanionModel.test.ts` — provider and action prompt tests.
- `packages/happy-app/sources/components/agents/AgentSpaceCompanionPanel.tsx` — panel layout, timer, pagination, reduce-motion, quick-action handoff.
- `packages/happy-app/sources/components/agents/AgentSpaceCompanionPanel.test.tsx` — timer, accessibility, close callback and action interaction tests.
- `packages/happy-app/sources/components/agents/agentSpacePanelRouting.ts` — pure ordinary-session versus Agent-space panel selector.
- `packages/happy-app/sources/components/agents/agentSpacePanelRouting.test.ts` — panel routing regressions.
- `packages/happy-app/sources/-session/SessionView.agentSpace.test.tsx` — panel handoff, composer insertion, exit accessibility and ordinary-session regression.
- `packages/happy-app/sources/components/agents/resolveAgentLaunchConfig.ts` — pure launch fallback resolution.
- `packages/happy-app/sources/components/agents/resolveAgentLaunchConfig.test.ts` — launch fallback matrix.
- `packages/happy-app/sources/components/agents/agentEditorModel.ts` — pure Agent save construction and duplicate validation.
- `packages/happy-app/sources/components/agents/agentEditorModel.test.ts` — editor save, space type and duplicate-path tests.
- `packages/happy-app/sources/components/agents/AgentSheet.test.tsx` — persisted-Agent entry wiring.
- `packages/happy-app/sources/components/agents/AgentSpaceWorkbench.test.tsx` — new/preset/history entry wiring.
- `packages/happy-app/sources/hooks/useEnterAgentSpace.ts` — the only coordinator that creates a new Agent-space session.
- `packages/happy-app/sources/hooks/useEnterAgentSpace.test.tsx` — atomic state, failure, navigation and duplicate-click tests.
- `packages/happy-app/sources/hooks/useSpawnSession.test.tsx` — non-navigating core and existing wrapper regression tests.
- `packages/happy-app/sources/hooks/useAgentSpace.test.tsx` — canonical hook matching and duplicate disambiguation.

### Modified files

- `packages/happy-app/sources/sync/settings.ts` / `settings.spec.ts` — add backward-compatible `spaceType` schema field.
- `packages/happy-app/sources/sync/localSettings.ts` / `localSettings.spec.ts` — immutable raw migration for legacy health Agents.
- `packages/happy-app/sources/components/agents/launchAgent.ts` and its tests/constructors — include required `spaceType` in runtime Agent objects.
- `packages/happy-app/sources/app/(app)/settings/my-agent-edit.tsx` — preserve/infer `spaceType` and reject duplicate canonical Agent paths.
- `packages/happy-app/sources/hooks/useSpawnSession.ts` — expose a non-navigating spawn core result while preserving the existing wrapper.
- `packages/happy-app/sources/components/agents/AgentSheet.tsx` — create a blank session instead of only setting `agentSpaceId`.
- `packages/happy-app/sources/components/agents/AgentSpaceWorkbench.tsx` — use the same coordinator for new/preset sessions.
- `packages/happy-app/sources/components/SidebarView.tsx` — expose drawer-close separately from historical-session navigation.
- `packages/happy-app/sources/hooks/useAgentSpace.ts` — expose the canonical matcher hook and retain simple enter/exit state operations.
- `packages/happy-app/sources/sync/storage.ts` — make `useAgentSpaceSessions` compare canonical paths.
- `packages/happy-app/sources/components/RightSwipePanelHost.tsx` — optional completion callback for `closePanel`.
- `packages/happy-app/sources/-session/SessionView.tsx` — canonical space match and panel-content routing.
- `packages/happy-app/sources/text/_default.ts` and every file under `sources/text/translations/` — Agent-space companion strings.

---

## Plan Document Checkpoint

- [ ] **Commit the reviewed plan before implementation**

```bash
git add docs/superpowers/plans/2026-07-13-agent-space-companion.md
git commit -m "docs(app): plan Agent space companion implementation"
```

Expected: the feature branch contains both the approved spec and reviewed plan before product-code commits begin.

---

## Chunk 1: Identity and Session Entry Foundation

### Task 1: Persist a stable Agent space type

**Files:**
- Modify: `packages/happy-app/sources/sync/settings.ts:51-66`
- Modify: `packages/happy-app/sources/sync/settings.spec.ts:90-120`
- Modify: `packages/happy-app/sources/sync/localSettings.ts:1-95`
- Create: `packages/happy-app/sources/sync/localSettings.spec.ts`
- Modify: `packages/happy-app/sources/components/agents/launchAgent.ts:4-18`
- Create: `packages/happy-app/sources/components/agents/agentEditorModel.ts`
- Test: `packages/happy-app/sources/components/agents/agentEditorModel.test.ts`
- Modify: `packages/happy-app/sources/app/(app)/settings/my-agent-edit.tsx:120-165`
- Modify: `packages/happy-app/sources/components/agents/builtinAgents.ts`
- Modify: `packages/happy-app/sources/components/agents/builtinAgents.spec.ts`
- Modify: `packages/happy-app/sources/components/agents/imageAgentMode.ts`
- Modify: `packages/happy-app/sources/components/agents/imageAgentMode.test.ts`
- Modify: `packages/happy-app/sources/components/agents/launchAgent.spec.ts`
- Modify: `packages/happy-app/sources/components/agents/imageAgentPrompt.test.ts`

- [ ] **Step 1: Write failing shared-schema and local-migration tests**

Add assertions equivalent to:

```ts
it('defaults legacy synchronized agents to the default space type', () => {
    const legacy = makeAgent({ path: '~/work' });
    expect(settingsParse({ agents: [legacy] }).agents[0]?.spaceType).toBe('default');
});

it('migrates only legacy local health agents to the health space type', () => {
    const result = localSettingsParse({
        agents: [
            makeAgent({ id: 'health', path: '~/人生辅助系统/健康打卡' }),
            makeAgent({ id: 'work', path: '~/work' }),
        ],
    });
    expect(result.agents.map((agent) => agent.spaceType)).toEqual(['health', 'default']);
});

it('preserves an explicit space type instead of re-inferring it', () => {
    const result = localSettingsParse({
        agents: [makeAgent({ path: '~/健康打卡', spaceType: 'default' })],
    });
    expect(result.agents[0]?.spaceType).toBe('default');
});

it('preserves spaceType when editing and infers it only for a new Agent', () => {
    expect(buildAgentForSave({ existing: makeAgent({ spaceType: 'default', path: '~/健康打卡' }), path: '~/健康打卡' }).spaceType).toBe('default');
    expect(buildAgentForSave({ existing: null, path: '~/健康打卡' }).spaceType).toBe('health');
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/sync/settings.spec.ts sources/sync/localSettings.spec.ts sources/components/agents/agentEditorModel.test.ts
```

Expected: FAIL because `spaceType` is missing and legacy local health Agents are not migrated.

- [ ] **Step 3: Add the schema field and immutable raw preprocessing**

In `AgentLauncherListSchema`, add:

```ts
spaceType: z.enum(['default', 'health']).default('default'),
```

Before `LocalSettingsSchemaPartial.safeParse`, clone only the raw Agent records that lack `spaceType`; set `health` when `isHealthCheckinSession(path)` matches and `default` otherwise. Do not mutate the caller's object. Keep the synchronized `SettingsSchema.agents` path on the shared default only.

Update `AgentLauncher` with:

```ts
spaceType: 'default' | 'health';
```

Add `spaceType` to `createAppBuilderAgent`, `createBuiltinImageStyleAgent`, `launchAgent.spec.ts`, `builtinAgents.spec.ts`, `imageAgentMode.test.ts`, and `imageAgentPrompt.test.ts`. Built-in/image Agents use `default`.

Implement `buildAgentForSave` in `agentEditorModel.ts`; make the Agent editor call it so the shared required type is satisfied in this task. Editing preserves `existing.spaceType`; new Agents infer once from the path. Duplicate validation is added in Task 2.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run the Step 2 command, then:

```bash
cd packages/happy-app && pnpm typecheck
```

Expected: all selected tests PASS, legacy synchronized settings still parse, and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/sync/settings.ts packages/happy-app/sources/sync/settings.spec.ts packages/happy-app/sources/sync/localSettings.ts packages/happy-app/sources/sync/localSettings.spec.ts packages/happy-app/sources/components/agents/launchAgent.ts packages/happy-app/sources/components/agents/launchAgent.spec.ts packages/happy-app/sources/components/agents/builtinAgents.ts packages/happy-app/sources/components/agents/builtinAgents.spec.ts packages/happy-app/sources/components/agents/imageAgentMode.ts packages/happy-app/sources/components/agents/imageAgentMode.test.ts packages/happy-app/sources/components/agents/imageAgentPrompt.test.ts packages/happy-app/sources/components/agents/agentEditorModel.ts packages/happy-app/sources/components/agents/agentEditorModel.test.ts 'packages/happy-app/sources/app/(app)/settings/my-agent-edit.tsx'
git commit -m "feat(app): add stable Agent space types"
```

### Task 2: Canonicalize Agent paths and match sessions deterministically

**Files:**
- Create: `packages/happy-app/sources/utils/agentSpaceIdentity.ts`
- Test: `packages/happy-app/sources/utils/agentSpaceIdentity.test.ts`
- Modify: `packages/happy-app/sources/hooks/useAgentSpace.ts`
- Test: `packages/happy-app/sources/hooks/useAgentSpace.test.tsx`
- Modify: `packages/happy-app/sources/sync/storage.ts:1520-1550`
- Modify: `packages/happy-app/sources/app/(app)/settings/my-agent-edit.tsx:45-170`
- Modify: `packages/happy-app/sources/components/agents/agentEditorModel.ts`
- Test: `packages/happy-app/sources/components/agents/agentEditorModel.test.ts`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`, `ru.ts`, `pl.ts`, `es.ts`, `ca.ts`, `it.ts`, `pt.ts`, `ja.ts`, `zh-Hans.ts`, `zh-Hant.ts`

- [ ] **Step 1: Write the failing identity tests**

Cover this table:

```ts
describe.each([
    ['~/work/', '/Users/jacky', '/Users/jacky/work'],
    ['/Users/jacky/work/', '/Users/jacky', '/Users/jacky/work'],
    ['C:\\Users\\Jacky\\Work\\', 'C:\\Users\\Jacky', 'c:/users/jacky/work'],
    ['\\\\Server\\Share\\Health', 'C:\\Users\\Jacky', '//server/share/health'],
])('canonicalizeAgentPath', (input, homeDir, expected) => {
    it(`${input} -> ${expected}`, () => {
        expect(canonicalizeAgentPath(input, homeDir)).toBe(expected);
    });
});

it('returns null when a tilde path has no home directory', () => {
    expect(canonicalizeAgentPath('~/work', undefined)).toBeNull();
});

it('prefers agentSpaceId among duplicate canonical candidates', () => {
    const agents = [
        { id: 'first', machineId: 'm1', path: '~/work' },
        { id: 'chosen', machineId: 'm1', path: '/Users/jacky/work/' },
    ];
    expect(matchAgentForSession({
        agents,
        agentSpaceId: 'chosen',
        machineId: 'm1',
        sessionPath: '/Users/jacky/work',
        homeDir: '/Users/jacky',
    })?.id).toBe('chosen');
});

it('returns null for ambiguous duplicates without agentSpaceId', () => {
    const agents = [
        { id: 'first', machineId: 'm1', path: '~/work' },
        { id: 'second', machineId: 'm1', path: '/Users/jacky/work' },
    ];
    expect(matchAgentForSession({
        agents,
        agentSpaceId: null,
        machineId: 'm1',
        sessionPath: '/Users/jacky/work',
        homeDir: '/Users/jacky',
    })).toBeNull();
});

it('detects duplicate machine plus canonical path in the editor', () => {
    expect(hasDuplicateAgentPath({
        agents: [{ id: 'existing', machineId: 'm1', path: '~/work' }],
        editingId: null,
        machineId: 'm1',
        path: '/Users/jacky/work/',
        homeDir: '/Users/jacky',
    })).toBe(true);
});

it('filters Agent-space sessions using the same canonical path contract', () => {
    const sessions = [
        makeSession('match', 'm1', '/Users/jacky/work'),
        makeSession('other', 'm1', '/Users/jacky/other'),
    ];
    expect(selectAgentSpaceSessions({ sessions, machineId: 'm1', agentPath: '~/work', homeDir: '/Users/jacky' }).map((session) => session.id)).toEqual(['match']);
});
```

- [ ] **Step 2: Run the new test to verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/utils/agentSpaceIdentity.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure identity module**

Export focused functions:

```ts
export function canonicalizeAgentPath(path: string | null | undefined, homeDir?: string | null): string | null;

export function matchAgentForSession<T extends AgentSpaceIdentity>(args: {
    agents: readonly T[];
    agentSpaceId: string | null;
    machineId: string | null | undefined;
    sessionPath: string | null | undefined;
    homeDir: string | null | undefined;
}): T | null;

export function hasDuplicateAgentPath<T extends AgentSpaceIdentity>(args: {
    agents: readonly T[];
    editingId: string | null;
    machineId: string;
    path: string;
    homeDir: string | null | undefined;
}): boolean;

export function selectAgentSpaceSessions<T extends AgentSpaceSessionIdentity>(args: {
    sessions: readonly T[];
    machineId: string;
    agentPath: string;
    homeDir: string | null | undefined;
}): T[];
```

Keep the module independent of React, storage, and UI components. Windows drive/UNC paths compare case-insensitively; POSIX paths preserve case.

- [ ] **Step 4: Run the identity test to verify GREEN**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing consumer tests before wiring**

In `useAgentSpace.test.tsx`, use a small `react-test-renderer` HookHarness with mocked storage values. Assert that an Agent saved as `~/work` matches a session at `/Users/jacky/work`, and that ambiguous duplicates return null without a matching `agentSpaceId`.

In `agentEditorModel.test.ts`, add:

```ts
it('rejects a duplicate canonical machine and path on save', () => {
    const result = validateAgentSave({
        agents: [makeAgent({ id: 'existing', machineId: 'm1', path: '~/work' })],
        editingId: null,
        machineId: 'm1',
        path: '/Users/jacky/work/',
        homeDir: '/Users/jacky',
    });
    expect(result).toEqual({ ok: false, reason: 'duplicate-path' });
});
```

Run:

```bash
pnpm --filter happy-app exec vitest run sources/hooks/useAgentSpace.test.tsx sources/components/agents/agentEditorModel.test.ts
```

Expected: FAIL because consumers still use strict matching and the editor model has no duplicate validator.

- [ ] **Step 6: Wire all identity consumers and duplicate UI**

- Add `useSpaceAgentForSession(session)` in `useAgentSpace.ts`; read Agents, machines and `agentSpaceId`, then call `matchAgentForSession`.
- Change `useAgentSpaceSessions` to resolve the machine home directory and delegate to `selectAgentSpaceSessions`.
- Add `validateAgentSave` to `agentEditorModel.ts`; in the Agent editor, save-guard duplicate canonical machine/path entries while preserving the Task 1 space-type behavior.
- Add `agents.duplicatePath`, `agentSpace.entering`, and `agentSpace.enterFailed` to `_default.ts` and every current translation file in this task. The duplicate key is consumed by Task 2; the entry keys are created now so Task 3 remains type-safe when it introduces the coordinator UI. Use the existing Modal system for the duplicate save attempt.

- [ ] **Step 7: Run pure and consumer tests plus typecheck**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/utils/agentSpaceIdentity.test.ts sources/hooks/useAgentSpace.test.tsx sources/components/agents/agentEditorModel.test.ts sources/sync/settings.spec.ts sources/sync/localSettings.spec.ts
cd packages/happy-app && pnpm typecheck
```

Expected: all selected tests PASS and typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add packages/happy-app/sources/utils/agentSpaceIdentity.ts packages/happy-app/sources/utils/agentSpaceIdentity.test.ts packages/happy-app/sources/hooks/useAgentSpace.ts packages/happy-app/sources/hooks/useAgentSpace.test.tsx packages/happy-app/sources/sync/storage.ts packages/happy-app/sources/components/agents/agentEditorModel.ts packages/happy-app/sources/components/agents/agentEditorModel.test.ts 'packages/happy-app/sources/app/(app)/settings/my-agent-edit.tsx' packages/happy-app/sources/text/_default.ts packages/happy-app/sources/text/translations/en.ts packages/happy-app/sources/text/translations/ru.ts packages/happy-app/sources/text/translations/pl.ts packages/happy-app/sources/text/translations/es.ts packages/happy-app/sources/text/translations/ca.ts packages/happy-app/sources/text/translations/it.ts packages/happy-app/sources/text/translations/pt.ts packages/happy-app/sources/text/translations/ja.ts packages/happy-app/sources/text/translations/zh-Hans.ts packages/happy-app/sources/text/translations/zh-Hant.ts
git commit -m "fix(app): match Agent spaces by canonical path"
```

### Task 3: Extract the non-navigating spawn core and Agent-space coordinator

**Files:**
- Modify: `packages/happy-app/sources/hooks/useSpawnSession.ts`
- Test: `packages/happy-app/sources/hooks/useSpawnSession.test.tsx`
- Create: `packages/happy-app/sources/components/agents/resolveAgentLaunchConfig.ts`
- Test: `packages/happy-app/sources/components/agents/resolveAgentLaunchConfig.test.ts`
- Create: `packages/happy-app/sources/hooks/useEnterAgentSpace.ts`
- Test: `packages/happy-app/sources/hooks/useEnterAgentSpace.test.tsx`
- Modify: `packages/happy-app/sources/components/agents/AgentSheet.tsx`
- Test: `packages/happy-app/sources/components/agents/AgentSheet.test.tsx`
- Modify: `packages/happy-app/sources/components/agents/AgentSpaceWorkbench.tsx`
- Test: `packages/happy-app/sources/components/agents/AgentSpaceWorkbench.test.tsx`
- Modify: `packages/happy-app/sources/components/SidebarView.tsx`

- [ ] **Step 1: Write failing launch-config tests**

Test the exact precedence:

```ts
expect(resolveAgentLaunchConfig({ agent: runtimeAgent, draft, defaults })).toMatchObject({
    agent: runtimeAgent.agentType,
    permissionMode: runtimeAgent.permissionMode,
});

expect(resolveAgentLaunchConfig({ agent: persistedAgent, draft, defaults })).toMatchObject({
    agent: draft.agentType,
    permissionMode: draft.permissionMode,
    modelMode: draft.modelMode,
    effortLevel: draft.effortLevel,
});
```

Also test fallback to `resolveAgentDefaultConfig` and an explicit invalid/missing agent-type result.

- [ ] **Step 2: Write failing coordinator tests**

Mock the spawn core, navigation, state setter and storage. Verify:

- successful blank entry calls spawn with `prompt: ''`, writes `agentSpaceId`, then navigates;
- `beforeNavigate` runs after spawn but before state/navigation;
- optional `initialDraft` calls `updateSessionDraft(sessionId, prompt)` before navigation;
- offline/cancel/error never write space state or navigate;
- synchronous navigation throw restores the previous `agentSpaceId` and retains the session;
- a second click while `entering` returns without invoking spawn again.

- [ ] **Step 3: Write failing spawn-core boundary tests**

In `useSpawnSession.test.tsx`, mock the machine RPC, sync, navigation and Modal. Assert that the new core returns `sessionId` without calling `sync.sendMessage` or navigation, while the current `spawn` wrapper sends one initial message and navigates once. Add cancelled-directory and RPC-error cases.

- [ ] **Step 4: Run all foundation tests to verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/components/agents/resolveAgentLaunchConfig.test.ts sources/hooks/useSpawnSession.test.tsx sources/hooks/useEnterAgentSpace.test.tsx
```

Expected: FAIL because launch config/coordinator are missing and the spawn hook has no non-navigating core.

- [ ] **Step 5: Refactor `useSpawnSession` without changing current callers**

Introduce:

```ts
export type SpawnSessionCoreResult =
    | { type: 'success'; sessionId: string }
    | { type: 'cancelled' }
    | { type: 'error'; message: string };
```

Move only resolve path → machine RPC → directory approval recursion → refresh sessions → apply permission/model/effort into `spawnSession(args, approved?)`. The core never sends the initial message and never navigates. Keep existing `spawn(args)` as a wrapper that calls the core, sends prompt/attachments exactly once after success, then navigates and returns the current boolean contract. Return both from the hook so ComposeHome remains unchanged.

Add hook tests proving `spawnSession` returns the session ID without sending or navigating, while `spawn` sends the initial prompt/attachments exactly once, navigates and returns `true` on success. Cover cancelled directory creation and RPC error results.

- [ ] **Step 6: Implement launch config and `useEnterAgentSpace`**

The coordinator signature should be explicit:

```ts
type EnterOptions = {
    initialDraft?: string;
    beforeNavigate?: () => void;
};

enter(agent: AgentLauncher, options?: EnterOptions): Promise<EnterAgentSpaceResult>;
```

It uses the Agent-bound machine/path, launch config precedence, `worktreeKey: null`, and `prompt: ''`. On success, write `initialDraft` before navigation, call `beforeNavigate`, save previous space id, enter the new space, and navigate. Roll back only if navigation throws synchronously.

- [ ] **Step 7: Run focused tests to verify GREEN**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/components/agents/resolveAgentLaunchConfig.test.ts sources/hooks/useSpawnSession.test.tsx sources/hooks/useEnterAgentSpace.test.tsx
```

Expected: all selected tests PASS; existing ComposeHome behavior remains unchanged.

- [ ] **Step 8: Write component-level wiring tests**

Use `react-test-renderer` with mocked hooks:

- `AgentSheet.test.tsx`: pressing a persisted online Agent calls `enter(agent, { beforeNavigate })`; `onClose` is not called before the mocked coordinator invokes `beforeNavigate`; a second press while entering is disabled.
- `AgentSpaceWorkbench.test.tsx`: “new session” calls `enter(agent, { beforeNavigate: onCloseDrawer })`; a preset also passes `initialDraft`; a historical row calls `onNavigate('/session/id')` and never calls `enter`.

- [ ] **Step 9: Run component tests to verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/components/agents/AgentSheet.test.tsx sources/components/agents/AgentSpaceWorkbench.test.tsx
```

Expected: FAIL because both components still use `enterSpace`/`launchAgent` directly.

- [ ] **Step 10: Wire AgentSheet, AgentSpaceWorkbench and SidebarView**

- AgentSheet persisted Agent click: await coordinator; keep the sheet visible/disabled while entering; close only through `beforeNavigate` after spawn success.
- Add a separate `onCloseDrawer` prop to AgentSpaceWorkbench. Workbench “new session” calls the coordinator with `beforeNavigate: onCloseDrawer`; it does not replace the coordinator's standard `navigateToSession`.
- Workbench preset: call coordinator with `initialDraft: preset.prompt`; do not route through `/new` and do not send.
- Workbench historical-session row: keep direct navigation.
- SidebarView passes a close-only callback for new/preset entry and retains `go(path)` for historical rows.

- [ ] **Step 11: Run entry regressions and typecheck**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/hooks/useSpawnSession.test.tsx sources/hooks/useEnterAgentSpace.test.tsx sources/components/agents/AgentSheet.test.tsx sources/components/agents/AgentSpaceWorkbench.test.tsx sources/components/agents/launchAgent.spec.ts
cd packages/happy-app && pnpm typecheck
```

Expected: all selected tests PASS, the components call only the coordinator for creation, and typecheck exits 0.

- [ ] **Step 12: Commit**

```bash
git add packages/happy-app/sources/hooks/useSpawnSession.ts packages/happy-app/sources/hooks/useSpawnSession.test.tsx packages/happy-app/sources/hooks/useEnterAgentSpace.ts packages/happy-app/sources/hooks/useEnterAgentSpace.test.tsx packages/happy-app/sources/components/agents/resolveAgentLaunchConfig.ts packages/happy-app/sources/components/agents/resolveAgentLaunchConfig.test.ts packages/happy-app/sources/components/agents/AgentSheet.tsx packages/happy-app/sources/components/agents/AgentSheet.test.tsx packages/happy-app/sources/components/agents/AgentSpaceWorkbench.tsx packages/happy-app/sources/components/agents/AgentSpaceWorkbench.test.tsx packages/happy-app/sources/components/SidebarView.tsx
git commit -m "feat(app): enter Agent spaces with blank sessions"
```

---

## Chunk 2: Space Companion Panel

### Task 4: Add the provider-neutral companion model

**Files:**
- Create: `packages/happy-app/sources/components/agents/agentSpaceCompanionModel.ts`
- Test: `packages/happy-app/sources/components/agents/agentSpaceCompanionModel.test.ts`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`, `ru.ts`, `pl.ts`, `es.ts`, `ca.ts`, `it.ts`, `pt.ts`, `ja.ts`, `zh-Hans.ts`, `zh-Hant.ts`

- [ ] **Step 1: Write failing provider tests**

Verify the health provider returns exactly three Tips and four actions in the approved order, with stable IDs. Verify the default provider returns no Tips and maps `agent.presets` to actions without changing prompt text.

- [ ] **Step 2: Run the model test to verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/components/agents/agentSpaceCompanionModel.test.ts
```

Expected: FAIL because the model module does not exist.

- [ ] **Step 3: Add all translation keys**

Add one `agentSpace.companion` subtree to `_default.ts` and the ten enumerated translation files. It includes only companion-owned text: panel title/subtitle, the three Tip eyebrow/title/body triples, four action titles/prompts, pagination labels, and action/pagination accessibility labels. `agents.duplicatePath` and Agent entry strings already belong to Task 2. Do not hardcode user-visible text in the model or component.

- [ ] **Step 4: Implement the pure model**

Export:

```ts
export type AgentSpaceCompanionModel = {
    title: string;
    subtitle?: string;
    tips: CompanionTip[];
    actions: CompanionAction[];
};

export function buildAgentSpaceCompanionModel(agent: AgentLauncher): AgentSpaceCompanionModel;
```

Route only on `agent.spaceType`. Keep provider logic pure and independent of session messages/health files.

- [ ] **Step 5: Run model and translation type checks**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/components/agents/agentSpaceCompanionModel.test.ts
cd packages/happy-app && pnpm typecheck
```

Expected: test PASS and typecheck PASS; missing translation keys fail compilation.

- [ ] **Step 6: Commit**

```bash
git add packages/happy-app/sources/components/agents/agentSpaceCompanionModel.ts packages/happy-app/sources/components/agents/agentSpaceCompanionModel.test.ts packages/happy-app/sources/text/_default.ts packages/happy-app/sources/text/translations/en.ts packages/happy-app/sources/text/translations/ru.ts packages/happy-app/sources/text/translations/pl.ts packages/happy-app/sources/text/translations/es.ts packages/happy-app/sources/text/translations/ca.ts packages/happy-app/sources/text/translations/it.ts packages/happy-app/sources/text/translations/pt.ts packages/happy-app/sources/text/translations/ja.ts packages/happy-app/sources/text/translations/zh-Hans.ts packages/happy-app/sources/text/translations/zh-Hant.ts
git commit -m "feat(app): define Agent space companion content"
```

### Task 5: Make panel closing observable and build the companion UI

**Files:**
- Modify: `packages/happy-app/sources/components/RightSwipePanelHost.tsx:20-120`
- Create: `packages/happy-app/sources/components/RightSwipePanelHost.test.tsx`
- Create: `packages/happy-app/sources/components/agents/AgentSpaceCompanionPanel.tsx`
- Test: `packages/happy-app/sources/components/agents/AgentSpaceCompanionPanel.test.tsx`

- [ ] **Step 1: Write failing close-callback tests**

Test that `closePanel(onClosed)` invokes its callback exactly once after a finished close spring, never for an interrupted animation, and preserves existing no-argument calls.

- [ ] **Step 2: Write failing panel tests with fake timers**

Cover:

- Tip 1 renders initially;
- 7,999 ms does not switch, 8,000 ms switches once;
- clicking a pagination control selects the Tip and stops future auto-rotation;
- component unmount clears the timer;
- initially enabled reduce motion means no timer;
- enabling reduce motion at runtime clears an active timer; disabling it starts an eligible timer; unmount removes the `AccessibilityInfo` change listener;
- current pagination exposes `accessibilityState.selected`; pagination controls and actions have readable labels and button roles;
- pagination/action Pressables have at least 44×44 dp hit layout;
- pressing an action calls `closePanel(callback)` and only the callback invokes `onInsertPrompt`;
- the component registers no Pan gesture.

- [ ] **Step 3: Run the tests to verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/components/RightSwipePanelHost.test.tsx sources/components/agents/AgentSpaceCompanionPanel.test.tsx
```

Expected: FAIL because the callback API and panel do not exist.

- [ ] **Step 4: Extend `closePanel` minimally**

Change the context type to:

```ts
closePanel: (onClosed?: () => void) => void;
```

Use a JS completion helper from Reanimated's spring completion so `setOpen(false)` occurs before the optional callback. Guard the callback against interruption and double invocation. Do not alter open/close thresholds or gesture policy.

- [ ] **Step 5: Implement `AgentSpaceCompanionPanel`**

- Use `StyleSheet.create` from Unistyles and existing typography/theme tokens.
- Render identity header, optional Tips Hero, pagination and a two-column action grid.
- Initialize reduce-motion state as unresolved; use `AccessibilityInfo.isReduceMotionEnabled()` plus its change subscription, and do not start a timer until the async initial value resolves false.
- Start one 8-second interval only when there are multiple Tips, reduce-motion is resolved false and the user has not manually selected a Tip.
- Do not create a horizontal gesture.
- On action: haptic → `panel.closePanel(() => onInsertPrompt(prompt))`.
- Let `SessionView`'s current `ChatComposerHandle.setMessage` perform text, focus and cursor placement; Chunk 3 owns that integration verification.

- [ ] **Step 6: Run tests to verify GREEN**

Run the Step 3 command, awaiting the initial reduce-motion promise before advancing fake timers, then run:

```bash
cd packages/happy-app && pnpm typecheck
```

Expected: selected tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/happy-app/sources/components/RightSwipePanelHost.tsx packages/happy-app/sources/components/RightSwipePanelHost.test.tsx packages/happy-app/sources/components/agents/AgentSpaceCompanionPanel.tsx packages/happy-app/sources/components/agents/AgentSpaceCompanionPanel.test.tsx
git commit -m "feat(app): add Agent space companion panel"
```

---

## Chunk 3: Integration, Verification, PR and Preview OTA

### Task 6: Route Agent-space sessions to the companion panel

**Files:**
- Modify: `packages/happy-app/sources/-session/SessionView.tsx:100-390`
- Modify: `packages/happy-app/sources/hooks/useAgentSpace.ts`
- Create: `packages/happy-app/sources/components/agents/agentSpacePanelRouting.ts`
- Create: `packages/happy-app/sources/components/agents/agentSpacePanelRouting.test.ts`
- Create: `packages/happy-app/sources/-session/SessionView.agentSpace.test.tsx`

- [ ] **Step 1: Write a failing panel-routing test**

Create a pure selector so the branch is testable without mounting the full SessionView:

```ts
expect(selectSessionRightPanel({ spaceAgent: null })).toBe('capability-hub');
expect(selectSessionRightPanel({ spaceAgent: healthAgent })).toBe('companion');
expect(selectSessionRightPanel({ spaceAgent: defaultAgent })).toBe('companion');
```

Also assert that a `~/health` Agent matches a session with absolute cwd when the machine home is known.

In `SessionView.agentSpace.test.tsx`, use `react-test-renderer` plus focused module mocks to verify:

- a matched Agent renders `AgentSpaceCompanionPanel`, while an ordinary session renders `SessionCapabilityHub`;
- invoking the companion panel's `onInsertPrompt` prop calls the active composer handle's existing `setMessage(prompt)` only after the panel callback runs;
- the space exit control has `accessibilityRole="button"` and reuses the existing localized `agentSpace.exit` text as its accessibility label;
- `ChatComposerHandle.setMessage` remains the single focus/cursor owner. Automated verification proves the handoff calls this owner; Task 8 preview-OTA validation proves the actual native focus and cursor position.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/components/agents/agentSpacePanelRouting.test.ts sources/-session/SessionView.agentSpace.test.tsx
```

Expected: FAIL because routing still always creates `SessionCapabilityHub`.

- [ ] **Step 3: Replace SessionView's strict Agent lookup and panel branch**

- Use `useSpaceAgentForSession(session)` once and share the result with header skin and panel routing.
- Keep the existing header enter/exit behavior, and add `accessibilityRole="button"` plus `accessibilityLabel={t('agentSpace.exit')}` to the space exit Pressable.
- For phone sessions with a matched Agent, pass `buildAgentSpaceCompanionModel(spaceAgent)` to `AgentSpaceCompanionPanel` and reuse `handleInsertQuickPrompt`.
- For unmatched sessions, render the existing `SessionCapabilityHub` unchanged.
- Do not alter desktop diff/sidebar behavior.

- [ ] **Step 4: Run the routing and identity tests to verify GREEN**

Run:

```bash
pnpm --filter happy-app exec vitest run sources/utils/agentSpaceIdentity.test.ts sources/components/agents/agentSpaceCompanionModel.test.ts sources/components/agents/agentSpacePanelRouting.test.ts sources/-session/SessionView.agentSpace.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/-session/SessionView.tsx packages/happy-app/sources/-session/SessionView.agentSpace.test.tsx packages/happy-app/sources/hooks/useAgentSpace.ts packages/happy-app/sources/components/agents/agentSpacePanelRouting.ts packages/happy-app/sources/components/agents/agentSpacePanelRouting.test.ts
git commit -m "feat(app): show companion content in Agent spaces"
```

### Task 7: Run the full static verification and independent code review

**Files:** all files changed by Tasks 1-6.

- [ ] **Step 1: Run every focused test introduced or touched**

Run:

```bash
pnpm --filter happy-app exec vitest run \
  sources/sync/settings.spec.ts \
  sources/sync/localSettings.spec.ts \
  sources/utils/agentSpaceIdentity.test.ts \
  sources/hooks/useAgentSpace.test.tsx \
  sources/components/agents/agentEditorModel.test.ts \
  sources/components/agents/resolveAgentLaunchConfig.test.ts \
  sources/hooks/useSpawnSession.test.tsx \
  sources/hooks/useEnterAgentSpace.test.tsx \
  sources/components/agents/AgentSheet.test.tsx \
  sources/components/agents/AgentSpaceWorkbench.test.tsx \
  sources/components/agents/launchAgent.spec.ts \
  sources/components/agents/builtinAgents.spec.ts \
  sources/components/agents/imageAgentMode.test.ts \
  sources/components/agents/imageAgentPrompt.test.ts \
  sources/components/agents/agentSpaceCompanionModel.test.ts \
  sources/components/agents/AgentSpaceCompanionPanel.test.tsx \
  sources/components/RightSwipePanelHost.test.tsx \
  sources/components/agents/agentSpacePanelRouting.test.ts \
  sources/-session/SessionView.agentSpace.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 2: Run required package typecheck**

Run:

```bash
cd packages/happy-app && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Inspect the final diff and worktree**

Run:

```bash
git diff --check
git status --short
git diff main...HEAD --stat
```

Expected: no whitespace errors; only in-scope files changed.

- [ ] **Step 4: Request independent code review**

Use `requesting-code-review` against `main...HEAD`. Resolve all high/medium correctness issues, rerun focused tests and typecheck, and commit fixes separately.

- [ ] **Step 5: Final local verification commit if needed**

If review changes were required, stage only reviewed files interactively, commit, then repeat Steps 1-3 in full:

```bash
git add -p
git commit -m "fix(app): address Agent space review findings"
```

### Task 8: Push, open PR and follow preview OTA to completion

**Files:** GitHub branch/PR metadata; no new product files unless CI finds a real issue.

- [ ] **Step 1: Push the feature branch**

Run:

```bash
git push -u origin agent-space-companion
```

Expected: branch exists on `wangjs-jacky/happy` and includes the approved spec, reviewed plan and all implementation commits.

- [ ] **Step 2: Create the PR to `main`**

Run:

```bash
gh pr create --repo wangjs-jacky/happy --base main --head agent-space-companion \
  --title "feat(app): isolate Agent spaces and add companion panel" \
  --body-file /tmp/agent-space-companion-pr.md
```

Create `/tmp/agent-space-companion-pr.md` with `apply_patch` immediately before the command. The body must summarize behavior, list focused tests/typecheck, call out fixed Tips/no dynamic generation, and include the approved spec path.

Expected: PR URL returned.

- [ ] **Step 3: Monitor PR checks and preview workflow**

Use proxy-free GitHub CLI if the local proxy interferes:

```bash
PR_NUMBER=$(gh pr view --repo wangjs-jacky/happy --json number --jq .number)
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  gh pr checks "$PR_NUMBER" --repo wangjs-jacky/happy --watch
```

Expected: required checks and `ota-preview` complete successfully. If CI fails, inspect the exact log, make the smallest in-scope fix, rerun Task 7 Steps 1-3, then:

```bash
git add -p
git commit -m "fix(app): repair Agent space CI failure"
git push
```

Continue watching the new run until successful.

- [ ] **Step 4: Collect OTA evidence**

Read the stamped workflow/PR comment and record:

- channel: `preview`
- platform: `android`
- runtimeVersion: actual value from the stamped workflow manifest; never infer it from production settings
- full update UUID
- timestamp/stamp when present
- manifest URL
- PR/workflow URL

Use exact commands (the PR workflow intentionally does not update `preview/latest.json`):

```bash
PR_NUMBER=$(gh pr view --repo wangjs-jacky/happy --json number --jq .number)
HEAD_SHA=$(gh pr view "$PR_NUMBER" --repo wangjs-jacky/happy --json headRefOid --jq .headRefOid)
PR_URL=$(gh pr view "$PR_NUMBER" --repo wangjs-jacky/happy --json url --jq .url)
OTA_RUN_URL=$(gh pr checks "$PR_NUMBER" --repo wangjs-jacky/happy --json name,link,workflow --jq '.[] | select(.workflow == "Self-hosted OTA preview (per PR)") | .link' | tail -1)
OTA_RUN_ID=$(printf '%s\n' "$OTA_RUN_URL" | sed -n 's#.*/actions/runs/\([0-9][0-9]*\).*#\1#p')
WORKFLOW_SHA=$(gh run view "$OTA_RUN_ID" --repo wangjs-jacky/happy --json headSha --jq .headSha)
OTA_COMMENT=$(gh api "repos/wangjs-jacky/happy/issues/$PR_NUMBER/comments" --jq '[.[] | select(.body | contains("<!-- ota-preview-bot -->"))][-1].body')
OTA_ID=$(printf '%s\n' "$OTA_COMMENT" | sed -n 's/.*| Update ID | `\([^`]*\)`.*/\1/p')
OTA_STAMP=$(printf '%s\n' "$OTA_COMMENT" | sed -n 's/.*| stamp | `\([^`]*\)`.*/\1/p')
OTA_CHANNEL=$(printf '%s\n' "$OTA_COMMENT" | sed -n 's/.*| 频道 | `\([^`]*\)`.*/\1/p')
OTA_RUNTIME=$(printf '%s\n' "$OTA_COMMENT" | sed -n 's/.*| runtimeVersion | `\([^`]*\)`.*/\1/p')
OTA_COMMIT=$(printf '%s\n' "$OTA_COMMENT" | sed -n 's/.*| 对应 commit | `\([^`]*\)`.*/\1/p')
MANIFEST_URL=$(printf '%s\n' "$OTA_COMMENT" | sed -n 's/.*| manifest | \(https:[^ ]*\.json\) |.*/\1/p')
curl -fsSL "$MANIFEST_URL" -o /tmp/agent-space-companion-manifest.json
MANIFEST_ID=$(jq -r '.id' /tmp/agent-space-companion-manifest.json)
MANIFEST_RUNTIME=$(jq -r '.runtimeVersion' /tmp/agent-space-companion-manifest.json)
MANIFEST_COMMIT=$(jq -r '.extra.git.sha' /tmp/agent-space-companion-manifest.json)
MANIFEST_COMMIT_FULL=$(gh api "repos/wangjs-jacky/happy/commits/$MANIFEST_COMMIT" --jq .sha)
MANIFEST_HEAD_PARENT=$(gh api "repos/wangjs-jacky/happy/commits/$MANIFEST_COMMIT_FULL" --jq '.parents[1].sha')
test "$OTA_ID" = "$MANIFEST_ID"
test "$OTA_RUNTIME" = "$MANIFEST_RUNTIME"
test "$OTA_CHANNEL" = "preview"
case "$MANIFEST_URL" in */manifests/android/"$OTA_RUNTIME"/preview/"$OTA_STAMP".json) ;; *) exit 1 ;; esac
test "$WORKFLOW_SHA" = "$HEAD_SHA"
case "$MANIFEST_COMMIT_FULL" in "$MANIFEST_COMMIT"*) ;; *) exit 1 ;; esac
test "$OTA_COMMIT" = "$MANIFEST_COMMIT"
test "$MANIFEST_HEAD_PARENT" = "$HEAD_SHA"
```

Expected: all commands exit 0; the workflow run belongs to the PR head, the stamped Android/preview manifest ID/runtime/stamp match the bot comment, and the manifest's resolved synthetic merge commit has the current PR head as its second parent.

- [ ] **Step 5: Provide the preview-device handoff**

Extract the deep link from the bot comment and report it with the manual checklist:

1. Open `paws://ota-switch?channel=preview&stamp=$OTA_STAMP` on the preview device, substituting the verified shell value collected in Step 4.
2. Reload into the update and confirm `/dev → Expo Constants` shows the exact Update ID.
3. From an ordinary session enter Health Check-in; verify a blank session opens, old messages are absent, the companion panel replaces the generic hub, Tips rotate/pause, actions fill without sending, focus/cursor land at the end, right-swipe closes cleanly, and exit returns home.

Publishing + stamped-manifest verification completes the authorized automated delivery. Because this run has no real-device control authorization/tool, final reporting must mark the checklist as user handoff rather than falsely claiming it was performed.

- [ ] **Step 6: Report completion with Happy OTA metadata**

Final response must include implementation summary, tests/typecheck evidence, PR URL, the preview-device checklist/deep link, and this exact key template populated only from verified values:

```text
<happy-ota-preview>
title: Agent space companion panel
channel: preview
platform: android
runtimeVersion: $OTA_RUNTIME
updateId: $OTA_ID
stamp: $OTA_STAMP
manifestUrl: $MANIFEST_URL
sourceUrl: $PR_URL
summary: Static checks passed and the stamped preview manifest matches the PR head; device interaction checklist is ready for handoff.
</happy-ota-preview>
```

Do not claim automated delivery completion until the OTA workflow is successful and stamped-manifest verification matches. Do not claim real-device interaction validation until the user confirms the handoff checklist.
