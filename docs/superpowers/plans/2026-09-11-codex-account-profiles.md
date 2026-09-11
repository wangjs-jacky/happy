# Codex Account Profiles Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-10-codex-account-profiles-design.md`

**Goal:** Let a Paws account securely store multiple Codex OAuth profiles, bind one profile to each device, and inject only the bound credential into Paws-originated Codex sessions while showing passive 7-day quota status in Device Environment.

## Global Constraints

- Work only in the existing sibling worktree `happy--codex-account-profiles`; the root workspace remains clean `main`.
- Use test-driven development: add a focused failing test, observe RED, implement the minimum behavior, then observe GREEN.
- Never overwrite or mutate the device's global `~/.codex/auth.json`; session credentials use a temporary `CODEX_HOME` with restrictive permissions.
- The App must never receive raw Codex credentials. It receives profile metadata and opaque one-time grants only.
- Missing binding, invalid/deleted profile, expired/reused grant, or credential-version conflict must fail closed. Never fall back to the device's local Codex login or another stored profile.
- Binding is performed one device at a time. New-session UI has no account selector; new, resumed, and forked Codex sessions use that device's current binding.
- Upload command is exactly `paws codex account upload`, takes no account-name argument, reads the active local Codex auth file, and creates an automatic masked label such as `Codex · A7F2`.
- 7-day quota is updated only from rate-limit events produced by Paws-originated sessions using the profile. Do not poll, start hidden Codex calls, or attribute global/local usage. Unknown, stale (>24h), reset, and invalid-profile states follow the spec.
- Existing Claude token behavior and existing global Codex usage display remain compatible.
- Tauri is out of scope.
- App UI colors must use existing Unistyles semantic theme tokens; no hard-coded color values.
- Do not push, open a PR, merge, deploy, publish OTA, or publish npm artifacts.

## Task 1: Server persistence and secure account/profile API

**Files:**

- Modify `packages/happy-server/prisma/schema.prisma`
- Add `packages/happy-server/prisma/migrations/*_codex_account_profiles/migration.sql`
- Add `packages/happy-server/sources/app/api/routes/codexAccountRoutes.ts`
- Add `packages/happy-server/sources/app/api/routes/codexAccountRoutes.spec.ts`
- Modify `packages/happy-server/sources/app/api/api.ts`

Implement encrypted Codex profile storage, one-device binding, automatic deterministic masked labels, credential fingerprint deduplication, profile list/rename/delete, one-time short-lived session grants, atomic redeem, credential-version CAS update, and profile-attributed quota reporting. Store only encrypted auth JSON and non-secret metadata. Deleting a profile clears bindings transactionally. Grant redemption authenticates the daemon's Paws bearer and verifies its machine/profile/binding version.

Tests must cover upload/dedup, ownership isolation, per-device binding, delete clearing binding, grant single use/expiry/binding-change rejection, raw credential absence from App-facing responses, CAS conflict, and quota unknown/current/stale/reset/invalid behavior. Run focused Vitest and server typecheck.

## Task 2: CLI upload and daemon credential/grant lifecycle

**Files:**

- Modify `packages/happy-cli/src/commands/codexCommand.ts`
- Modify `packages/happy-cli/src/commands/codexCommand.test.ts`
- Modify `packages/happy-cli/src/api/api.ts`
- Modify `packages/happy-cli/src/codex/codexHome.ts`
- Modify `packages/happy-cli/src/codex/codexHome.test.ts`
- Modify `packages/happy-cli/src/daemon/run.ts`
- Modify `packages/happy-cli/src/modules/common/registerCommonHandlers.ts`
- Add or modify focused daemon tests as needed

Add the exact no-argument upload command. Validate and read the active local Codex `auth.json`, reject missing/malformed/tokenless files without uploading, and send it via authenticated Paws API without logging secrets. Extend the spawn RPC with `codexSessionGrant`. For both direct and tmux Codex spawn paths, redeem the opaque grant just-in-time, construct a temporary `CODEX_HOME`, and fail closed on errors. Track profile/version/home per session, collect only that temporary home's secondary (7d) rate-limit snapshot, report it on a bounded cadence and session exit, and remove temporary credential homes. Preserve Claude's token path.

Tests must prove command routing and validation, 0600 auth write, no global auth mutation, grant redemption/fail-closed behavior for both spawn paths, and profile-specific quota extraction/reporting. Run focused Vitest and CLI typecheck/build as appropriate.

## Task 3: App API and transparent Codex spawn integration

**Files:**

- Add `packages/happy-app/sources/sync/apiCodexAccounts.ts`
- Add `packages/happy-app/sources/sync/apiCodexAccounts.test.ts`
- Modify `packages/happy-app/sources/sync/ops.ts`
- Add or modify focused spawn tests

Create typed App-facing API helpers for profile metadata, rename/delete, one-machine binding, and opaque grant creation. Centralize Codex grant acquisition inside the machine spawn operation so new, resumed, and forked Codex sessions all use it without UI account selection. Do not request grants for Claude. Convert missing/invalid binding failures into concise user-readable errors while retaining machine/RPC context.

Tests must verify bearer/client headers, no raw credential field in public types, one-machine binding payload, grant creation for every Codex spawn entry path, no grant for Claude, and no account selector requirement. Run focused Vitest and App typecheck.

## Task 4: Device Environment account management UI and integration verification

**Files:**

- Add `packages/happy-app/sources/hooks/useCodexAccounts.ts`
- Add `packages/happy-app/sources/components/environment/CodexAccountSection.tsx`
- Add `packages/happy-app/sources/components/environment/CodexAccountSection.test.tsx`
- Modify `packages/happy-app/sources/components/environment/DeviceEnvironmentView.tsx`
- Modify `packages/happy-app/sources/components/environment/DeviceEnvironmentView.test.tsx`
- Modify `packages/happy-app/sources/text/_default.ts`
- Modify `packages/happy-app/sources/text/translations/zh-Hans.ts`

Add the Codex account section to the real Device Environment view. Show generated label, validity, update time, exact copyable command, rename/delete controls, and 7-day quota as percentage plus reset time. Render unknown, stale, reset, and invalid states per spec. Provide a per-device binding control that changes exactly one machine and no bulk action. Use semantic theme tokens and accessible/testable controls; do not add account selection to session creation.

Tests must cover rendered copy and command, copy action, all quota states, rename/delete confirmations, exact single-machine binding calls, missing/invalid states, narrow-layout containment, and semantic-token styling. Run focused tests and App typecheck.

Finally run relevant server, CLI, and App suites/typechecks. Start a real local web build if practical, use Ego only for browser verification, verify the Device Environment interaction on desktop and narrow viewport, and report each meaningful verified browser round with a private screenshot. Do not deploy.
