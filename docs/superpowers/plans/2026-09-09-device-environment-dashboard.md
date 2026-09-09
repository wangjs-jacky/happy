# Device Environment Dashboard Implementation Plan

> **For agentic workers:** Execute inline; use an independent reviewer for acceptance and the repository-required i18n translator. Existing user authorization covers implementation without another design approval.

**Goal:** Implement the approved compact device/tool matrix with automatic checks and single-cell, per-tool and fleet updates.

**Architecture:** A dependency-injected external store owns inspections and per-machine queues outside modal lifetime. Reuse existing environment RPC and daemon-issued plans. Targets belong to each machine's package source; preflight may narrow an action but must never expand user-approved scope or silently change versions. UI derives installation, update, authentication and connectivity separately.

**Tech Stack:** React Native / Web, Unistyles, TypeScript, Vitest, existing encrypted machine RPC, Ego browser.

**Spec:** Approved interaction draft at `/Users/jacky/jacky-github/paws-design-drafts/device-environment-20260909/index.html` and this conversation. Credential transfer and SSH transports are separate future work.

## Global constraints

- Worktree: `happy--device-environment-dashboard`; base `5d24c3712c743e0e87462a529341fcd3037171bb`.
- Three machines and five tools visible at 1365 × 768 desktop. Narrow screens scroll the device columns with tool identity retained.
- No explicit preview/alignment steps for routine upgrades. Separate install/login/repair actions.
- Different machines execute concurrently; a single machine executes one change at a time. An uncertain result stops that machine's remaining queue.
- Reopening the modal within the same authenticated app runtime retains progress. Browser/app termination is not a durable queue; reopening starts read-only inspection before any new mutation.
- No real software installations during automated acceptance. Use the real view/store with controlled RPC observations/results. Production is not deployed from a feature branch.
- Preserve daemon ownership, plan freshness and post-apply verification checks. Never infer successful mutation from a transport timeout.
- Use theme tokens and all supported translations. Follow Android runtime contract from machine-readable configuration.

## Tasks

### 1. Dashboard model and task store

Files: `sources/environment/environmentDashboard.ts`, `environmentDashboard.test.ts`, `sources/hooks/useEnvironmentDashboard.ts`.

Interfaces: `createEnvironmentDashboard(deps)` returns `getSnapshot`, `subscribe`, `setMachines`, `scan`, `update(scope)`, `runSingle(machineId, componentId)`; scope has optional machineId/componentId. All update candidates are frozen when clicked; single setup actions must be explicitly selected.

- [x] Test parallel devices and serial same-device jobs using deferred `inspect`/`apply` promises.
- [x] Test independent local target versions, stale plans, action changes, failed/uncertain mutations, offline transitions and account invalidation; preserve legacy missing/unsupported protocol tests.
- [x] Implement store, account/server-scoped runtime retention and automatic initial/reopen scan.
- [x] Run `pnpm --filter happy-app exec vitest run sources/environment/environmentDashboard.test.ts`.

Representative acceptance assertion:
```ts
await store.update({ componentId: 'github-cli' });
expect(apply.mock.calls.map(([id, request]) => [id, request.desired.targetVersion]))
    .toEqual([['mac-a', '2.80.0'], ['mac-b', '2.81.0']]);
```

### 2. Matrix UI and translation

Files: `sources/components/environment/DeviceEnvironmentView.tsx`, component tests, desktop modal integration test, translations.

- [x] Replace card stack with tool rows/device columns and fixed summary/update footer. Preserve navigation's existing modal header.
- [x] Render persistent scan, single update, per-tool update and all-update actions with exact scopes and accessible names.
- [x] Put component-specific diagnostics and setup actions in an inline detail area. Normal upgrades are direct; setup requiring user interaction gets a concrete confirmation.
- [x] Verify semantic theme colors, small screen overflow, no mutation on opening, and no obsolete preview controls.
- [x] Run targeted component/integration tests and app typecheck.

### 3. Acceptance and delivery

- [x] Independent diff review against Cases below.
- [x] Real Ego browser acceptance using the actual component/hook/store with injected RPC fixtures; no production package commands.
- [x] Capture required verified browser frames and playable final-case video, then independent desktop interaction review. Narrow-screen checks were performed by the implementer; native rendering remains unverified.
- [ ] Commit, push feature branch, create PR using repository template; no merge or production deployment without scope expansion. Publish compatible preview OTA under repository delivery contract and report exact metadata.

## Cases

| Case | Observable acceptance | Before/base |
| --- | --- | --- |
| ENV-1 | Auto check; three device columns/five tools fit desktop; scan remains visible | base above, settings/device-environment |
| ENV-2 | Single and per-tool upgrades only mutate selected eligible cells | base selected-component preview flow |
| ENV-3 | All upgrades run across devices concurrently and within one device serially | base had no fleet multi-tool action |
| ENV-4 | Errors/offline/auth/source differences are local; result verification is explicit | base aggregate health card |
| ENV-5 | Close/reopen keeps running tasks; account/server changes prevent queued dispatch | base component-local hook |
| ENV-6 | Narrow screen and non-default dark theme keep actions readable/accessible | base card grid |

PR before/after screenshot matrix is optional per repository policy; user-mandated Ego round screenshots are retained. Production installations, native-device execution, and daemon restart durability are not proven by the controlled browser fixtures.

## Acceptance result (2026-09-09)

- Automated: 111/111 tests across dashboard store, hook lifetime, matrix UI, actual desktop navigation integration, legacy hook/fleet protocol and OTA runtime contract; App typecheck passed. The renderer prints its existing deprecation notice.
- Independent review: Pass after fixing machine-wide unresolved blocking, stale success details, busy-time reconnect scans and reopen-triggered result loss. Independent targeted tests: 31/31.
- Browser: ENV-1..5 and desktop dark ENV-6 independently passed. Main acceptance additionally verified 390 × 844 horizontal scrolling with a fixed tool column and no page overflow.
- Positive video: 1366 × 768 H.264 / yuv420p / 30 fps, 17.77 seconds; full decode and sampled visual review. Demonstrates single-tool, per-type, all-available updates and close/reopen; uses only controlled RPC responses.
- Re-run entry: `packages/happy-app/sources/trash/environment-dashboard/README.md`.
- Unknown-result recovery is deliberate: ordinary inspection never proves a remote process stopped. All mutations on that machine remain blocked until the user explicitly attests completion on the target device; acknowledgment only rescans, never retries.
- Scope limits: queues survive modal closure only in the same authenticated App runtime. No daemon/server persistence or new machine-wide backend lock is introduced. Cross-client concurrent operations, real installations, production modal focus integration and native devices are not proven by the fixture. Secret transfer is not implemented in this change.
