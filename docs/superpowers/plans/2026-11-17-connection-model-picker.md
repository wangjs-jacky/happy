# Connection-aware model picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let Paws select configured models by connection, starting a new session across connections and preserving defaults and existing sessions.
**Architecture:** Explicit per-launch Codex connection references, a native model-discovery RPC, and connection-qualified composer options reuse existing grant and spawn paths. Independent server and CLI changes can run in parallel with the App integration.
**Tech Stack:** TypeScript, React Native/Expo, encrypted machine RPC, Fastify/Prisma, Vitest.
**Spec:** `docs/superpowers/specs/2026-11-17-connection-model-picker-design.md`

## Global Constraints
- Root workspace remains clean main; all implementation is in this sibling worktree.
- No device binding mutation, history forwarding, worker restart, inference during discovery, polling, or Tauri work.
- Existing implicit grants and audited resume/service paths retain their current checks.
- Explicit unavailable connections fail; never fall back to a different connection.
- User authorized direct execution; do not repeat design/plan approval.

## Review Focus
- Same model ID on two connections must not share selection identity.
- A connection decision must survive grant issuance and spawn, including native null versus absent/default.
- Late directory/auth/machine responses and duplicate clicks must not launch a wrong/second session.
- Account grants must remain owned, single-use, credential-version-bound, and unable to change an existing session's profile.
- Launch failure preserves the original session, model, draft, route, and machine binding.

### Task 1: Explicit fresh-account launch grants
**Files:** `packages/happy-server/sources/app/api/routes/codexAccountTypes.ts`, `codexAccountRoutes.ts`, `codexAccountStore.ts`, associated route specs.
**Interface:** POST `/v1/codex-session-grants` gains optional `profileId: UUID` for fresh explicit-account launches. Omitted retains existing behavior; combining with sourceSessionId is rejected. Response remains unchanged. No machine binding write.
- [x] Add failing ownership/default-unchanged/redeem/single-use/resume-incompatibility cases.
- [x] Implement the narrow explicit-profile path without weakening implicit default/resume/service checks.
- [x] Run route specs and server typecheck.

### Task 2: Native directory discovery
**Files:** new `packages/happy-cli/src/daemon/codexNativeModels.ts` and tests; daemon registration/types.
**Interface:** encrypted machine RPC `list-codex-native-models` accepts `{}` and returns `{type:'success', models: Array<{code:string,value:string,description?:string|null}>}` or `{type:'error',errorMessage:string}`. Reads the machine's native configuration using an isolated short-lived Codex model/list connection, returns no secrets, and closes it. Native model IDs are exact, including case/slashes.
- [x] Add failing tests for managed env isolation, exact metadata mapping, close-on-failure, no inference/default writes.
- [x] Implement/register one-shot discovery; expose a machine capability so old clients retain behavior.
- [x] Run relevant CLI specs and typecheck.

### Task 3: App launch and connection-qualified options
**Files:** `sources/sync/apiCodexAccounts.ts`, `sources/sync/ops.ts`; new `sources/utils/modelConnections.ts`, hook/action modules and tests; session/new composer integration.
**Interface:** App `CodexConnection = {type:'native'} | {type:'account',profileId:string}`; `machineSpawnNewSession` gets optional `codexConnection`. Explicit native skips grants; explicit account supplies profileId. Existing absent selections retain default binding/version checks. No persistence of grants.
- [x] Write and observe failing launch transport, duplicate-model, same/cross-connection, error-preservation and stale-response tests.
- [x] Implement qualified entries, user-triggered native discovery, per-profile matching catalogs, and cross-connection launch action.
- [x] Integrate the existing session picker and new-session picker, preserving same-connection behavior and old sessions/drafts.
- [x] Run App related tests, full suite and typecheck; run runtime contract.

### Task 4: Integrated review and delivery
- [x] Independently review actual diff and all C1–C6 cases, fix findings and rerun affected checks.
- [x] Run permitted focused interaction validation; screenshots only if requested under repository policy. Document native/browser gaps accurately.
- [ ] Record final validation and create the reviewable PR; do not merge/deploy/activate without release authorization.

## Implementation decisions and review fixes
- Explicit grants use a named exact -1 binding marker, avoiding a database migration; all nonexplicit binding/version checks stay intact.
- Metadata reads use a dedicated readonly route: a query flag would be ignored by older servers and could trigger migration.
- Native discovery returns the exact model launch ID and omits hidden entries; it advertises its machine capability on connect, including existing machine records.
- Init/fallback cleanup now awaits child exit because discovery failure must not leak producers.
- Focus/route ownership permanently invalidates pending cross-connection navigation, including blur→refocus.
- New-page connection preference is persisted separately from device binding, and cleared on machine switch.
