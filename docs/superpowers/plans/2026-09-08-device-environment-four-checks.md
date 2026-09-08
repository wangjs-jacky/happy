# Device Environment Four-Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fleet-wide Paws CLI, Ego Lite/Ego CLI, Wrangler, and cloudflared health checks while preserving GitHub CLI alignment and allowing Paws alignment only for verified npm-global ownership.

**Architecture:** Generalize the strict wire observation into a bounded component-capability contract, then register one adapter per tool behind the existing environment RPC. Keep planning/apply single-component and daemon-issued; the app stores observations per machine and renders independent component rows so one failed probe cannot erase the others.

**Tech Stack:** TypeScript, Zod, Node child processes, React Native/React Native Web, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-device-environment-four-checks-design.md`

## Global Constraints

- Component IDs are exactly `github-cli`, `paws-cli`, `ego-browser`, `cloudflare-wrangler`, and `cloudflared`.
- Inspect accepts one to five unique IDs; apply remains exactly one desired component and daemon-issued plan.
- Only GitHub CLI and verified npm-owned Paws CLI are alignable in this release.
- Ego, Wrangler, and cloudflared are inspect-only.
- Never return raw stdout/stderr, tokens, cookies, email addresses, complete Cloudflare account IDs, certificate contents, or config contents.
- All process calls use fixed argument arrays, bounded output, and explicit timeouts.
- Paws `--version` must complete without authentication or session creation.
- Ego health inspection must not create a browser task space.
- Network failure for latest-version/auth checks must preserve usable local-version observations.

---

### Task 1: Generalize the strict environment wire contract

**Files:**
- Modify: `packages/happy-wire/src/environment.ts`
- Modify: `packages/happy-wire/src/environment.test.ts`

**Interfaces:**
- Produces: `EnvironmentComponentId`, `ComponentObservation`, `EnvironmentInspectRequest`, and existing plan/apply types used by all later tasks.
- `ComponentObservation` keeps common fields and adds `capability`, generalized `source`, optional bounded `authentication`, and discriminated `details`.

- [ ] **Step 1: Write failing wire tests**

Add literal fixtures that parse all five component details, accept five unique IDs, and reject duplicates, a sixth ID, raw-output-shaped extra fields, account IDs, and more than eight account labels:

```ts
expect(EnvironmentInspectRequestSchema.parse({
  componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'],
}).componentIds).toHaveLength(5);

expect(() => ComponentObservationSchema.parse({
  ...pawsObservation,
  stdout: 'secret process output',
})).toThrow();
```

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/happy-wire vitest run src/environment.test.ts`

Expected: FAIL because the new IDs and fields are rejected.

- [ ] **Step 3: Implement the minimal Zod contract**

Use strict bounded schemas and a discriminated details union:

```ts
const EnvironmentDetailsSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github-cli') }).strict(),
  z.object({ kind: z.literal('paws-cli') }).strict(),
  z.object({ kind: z.literal('ego-browser'), appVersion: z.string().nullable(), chromiumVersion: z.string().nullable(), nodeVersion: z.string().nullable(), paired: z.boolean() }).strict(),
  z.object({ kind: z.literal('cloudflare-wrangler') }).strict(),
  z.object({ kind: z.literal('cloudflared'), tunnelCertificatePresent: z.boolean() }).strict(),
]);
```

Define source kinds `homebrew | npm-global | app-managed | none`, ownership `verified | unverified | not-applicable`, capability `alignable | inspect-only`, and optional authentication with provider `github.com | cloudflare`, status, optional `principal`, and at most eight account labels. Add a `superRefine` check rejecting duplicate component IDs.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --dir packages/happy-wire vitest run src/environment.test.ts && pnpm --dir packages/happy-wire typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-wire/src/environment.ts packages/happy-wire/src/environment.test.ts
git commit -m "feat(wire): model multi-tool environment health"
```

### Task 2: Preserve GitHub behavior and add Paws inspection/alignment

**Files:**
- Modify: `packages/happy-cli/src/environment/componentAdapter.ts`
- Modify: `packages/happy-cli/src/environment/githubCliAdapter.ts`
- Modify: `packages/happy-cli/src/environment/githubCliAdapter.test.ts`
- Create: `packages/happy-cli/src/environment/pawsCliAdapter.ts`
- Create: `packages/happy-cli/src/environment/pawsCliAdapter.test.ts`
- Modify: `packages/happy-cli/src/environment/environmentService.ts`
- Modify: `packages/happy-cli/src/environment/environmentService.test.ts`

**Interfaces:**
- Produces: `createPawsCliAdapter(deps): EnvironmentComponentAdapter`.
- `EnvironmentComponentAdapter` exposes `alignment: 'supported' | 'inspect-only'`; `plan` and `apply` are optional and required by the service only for supported adapters.
- Paws parses `happy version: X.Y.Z`, verifies npm-global ownership, and applies exact `@wangjs-jacky/paws@X.Y.Z`.

- [ ] **Step 1: Write failing GitHub compatibility and service capability tests**

Assert the migrated GitHub observation has the new common fields without changing plan/apply decisions. Assert the service can inspect an inspect-only adapter but rejects desired/apply requests for it without invoking a process.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/environment/githubCliAdapter.test.ts src/environment/environmentService.test.ts`

Expected: FAIL because the adapter interface and observations still use the GitHub-only shape.

- [ ] **Step 3: Migrate the adapter/service minimally**

Keep existing fingerprints and approval issuance. Replace fixed-field reads with `source.latestVersion` and `source.ownership`; require `adapter.alignment === 'supported'`, `plan`, and `apply` before issuing or applying a plan. Preserve per-component locks and sanitized logging.

- [ ] **Step 4: Verify migrated GitHub tests pass**

Run the command from Step 2.

Expected: PASS with original GitHub behavior assertions intact.

- [ ] **Step 5: Write failing Paws parser, ownership, degraded-network, plan, and apply tests**

Cover:

```ts
expect(parsePawsCliVersion('happy version: 1.3.5\n')).toBe('1.3.5');
expect(parsePawsCliVersion('Starting authentication...')).toBeNull();
```

Prove that a local version survives npm latest-version timeout, non-owned executables yield manual repair, verified ownership yields install/upgrade/none, and apply uses an exact package version.

- [ ] **Step 6: Verify Paws RED**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/environment/pawsCliAdapter.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 7: Implement the Paws adapter**

Resolve `paws` and `npm`, run only `paws --version`, `npm view @wangjs-jacky/paws version --json`, and `npm prefix -g` during inspection. Compare realpaths beneath the global prefix. Apply only:

```ts
await runner.run(npmPath, ['install', '--global', `@wangjs-jacky/paws@${approvedPlan.targetVersion}`], options);
```

- [ ] **Step 8: Verify Paws GREEN and combined environment suite**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/environment/pawsCliAdapter.test.ts src/environment/githubCliAdapter.test.ts src/environment/environmentService.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/happy-cli/src/environment
git commit -m "feat(cli): inspect and align verified Paws installs"
```

### Task 3: Add Ego Lite/Ego CLI readiness inspection

**Files:**
- Create: `packages/happy-cli/src/environment/egoBrowserAdapter.ts`
- Create: `packages/happy-cli/src/environment/egoBrowserAdapter.test.ts`

**Interfaces:**
- Produces: `createEgoBrowserAdapter(deps): EnvironmentComponentAdapter` with `alignment: 'inspect-only'`.
- Produces: `parseEgoBrowserVersion(stdout)` returning CLI, Chromium, and Node versions or `null`.

- [ ] **Step 1: Write failing parser and inspection tests**

```ts
expect(parseEgoBrowserVersion(
  'ego-browser 0.4.7.4\n  chromium 150.0.7871.101\n  node v24.18.0\n',
)).toEqual({ cliVersion: '0.4.7.4', chromiumVersion: '150.0.7871.101', nodeVersion: '24.18.0' });
```

Cover missing CLI, missing app, malformed output, and mismatched versions. Assert the runner receives only `['--version']`; no `nodejs`, task-space, page, or profile command is invoked.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/environment/egoBrowserAdapter.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the inspect-only adapter**

Resolve documented `~/.local/bin/ego-browser`, read `CFBundleShortVersionString` through an injected plist reader for system/user Applications, and set `paired` only when CLI and app versions match.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-cli/src/environment/egoBrowserAdapter.ts packages/happy-cli/src/environment/egoBrowserAdapter.test.ts
git commit -m "feat(cli): inspect Ego browser readiness"
```

### Task 4: Add sanitized Wrangler and cloudflared inspection

**Files:**
- Create: `packages/happy-cli/src/environment/wranglerAdapter.ts`
- Create: `packages/happy-cli/src/environment/wranglerAdapter.test.ts`
- Create: `packages/happy-cli/src/environment/cloudflaredAdapter.ts`
- Create: `packages/happy-cli/src/environment/cloudflaredAdapter.test.ts`

**Interfaces:**
- Produces: `createWranglerAdapter(deps)` and `parseWranglerWhoami(stdout)` returning only authentication status and sanitized account labels.
- Produces: `createCloudflaredAdapter(deps)` and `parseCloudflaredVersion(stdout)`.

- [ ] **Step 1: Write failing Wrangler tests**

Fixtures include an email and 32-character account ID. Assert serialized observations do not contain `@`, the ID, token-shaped strings, permissions, or raw output. Cover unauthenticated and timed-out `whoami` while preserving the local version.

- [ ] **Step 2: Verify Wrangler RED**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/environment/wranglerAdapter.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement Wrangler inspection**

Resolve `wrangler` and `npm`, parse version, query `npm view wrangler version --json`, and run `wrangler whoami`. Parse only Account Name values, cap labels at eight and 128 characters, and discard all other output.

- [ ] **Step 4: Verify Wrangler GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Write failing cloudflared tests**

Assert parsing of `cloudflared version 2026.8.3 (...)`, Homebrew latest-version degradation, and certificate existence represented only as a boolean.

- [ ] **Step 6: Verify cloudflared RED**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/environment/cloudflaredAdapter.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 7: Implement cloudflared inspection**

Resolve Homebrew/cloudflared, reuse strict Homebrew JSON parsing through a shared parser, and call only injected `pathExists` for `~/.cloudflared/cert.pem`.

- [ ] **Step 8: Verify both adapters GREEN**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/environment/wranglerAdapter.test.ts src/environment/cloudflaredAdapter.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/happy-cli/src/environment
git commit -m "feat(cli): inspect Cloudflare tooling safely"
```

### Task 5: Register all adapters and isolate mixed inspection failures

**Files:**
- Modify: `packages/happy-cli/src/api/apiMachine.ts`
- Modify: `packages/happy-cli/src/api/apiMachine.test.ts`
- Modify: `packages/happy-cli/src/environment/environmentService.ts`
- Modify: `packages/happy-cli/src/environment/environmentService.test.ts`
- Modify: `packages/happy-cli/src/environment/registerEnvironmentHandlers.test.ts`

**Interfaces:**
- Consumes the five adapter factories.
- Produces one ordered response matching requested component IDs.

- [ ] **Step 1: Write failing registration and failure-isolation tests**

Assert `ApiMachine` registers all five adapters. Put one throwing adapter between two healthy adapters and assert only its observation becomes component-local unknown.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/happy-cli vitest run --project unit src/api/apiMachine.test.ts src/environment/environmentService.test.ts src/environment/registerEnvironmentHandlers.test.ts`

Expected: FAIL because only GitHub is registered and fixtures allow one ID.

- [ ] **Step 3: Implement registration and ordered isolation**

Construct all adapters with injected process/filesystem dependencies. Inspect selected adapters concurrently with `Promise.allSettled` and map failures by requested ID.

- [ ] **Step 4: Verify GREEN and CLI typecheck**

Run Step 2, then `pnpm --dir packages/happy-cli typecheck`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-cli/src/api/apiMachine.ts packages/happy-cli/src/api/apiMachine.test.ts packages/happy-cli/src/environment
git commit -m "feat(cli): expose fleet environment health checks"
```

### Task 6: Model per-machine component observations in the app

**Files:**
- Modify: `packages/happy-app/sources/environment/fleetModel.ts`
- Modify: `packages/happy-app/sources/environment/fleetModel.test.ts`
- Modify: `packages/happy-app/sources/hooks/useDeviceEnvironment.ts`
- Modify: `packages/happy-app/sources/hooks/useDeviceEnvironment.test.ts`

**Interfaces:**
- Produces: `FleetComponentRow` keyed by component ID and `FleetRow.components` containing five stable entries.
- Alignment target, plan, and results are component-scoped; presence remains machine-scoped.

- [ ] **Step 1: Write failing fleet-model tests**

Assert observations map by ID, missing observations affect only that component, offline machines have five skipped rows, and GitHub target resolution ignores other versions.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/happy-app vitest run sources/environment/fleetModel.test.ts`

Expected: FAIL because `FleetRow` carries one observation.

- [ ] **Step 3: Implement the component map**

Add a stable five-ID list and pure mapping functions. Keep existing GitHub aliases only during migration and remove them before Task 7.

- [ ] **Step 4: Verify fleet-model GREEN**

Run Step 2.

Expected: PASS.

- [ ] **Step 5: Write failing hook tests**

Assert scan sends all five IDs per online machine, publishes partial results, keeps offline rows, retains dispatched results across registry changes, and never applies inspect-only components.

- [ ] **Step 6: Verify hook RED**

Run: `pnpm --dir packages/happy-app vitest run sources/hooks/useDeviceEnvironment.test.ts`

Expected: FAIL because the hook requests only GitHub.

- [ ] **Step 7: Implement component-scoped state**

Keep epoch/ref guards, daemon plan-age checks, and result retention. Add selected alignable component actions for GitHub/Paws and reject inspect-only IDs before RPC.

- [ ] **Step 8: Verify GREEN**

Run: `pnpm --dir packages/happy-app vitest run sources/environment/fleetModel.test.ts sources/hooks/useDeviceEnvironment.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/happy-app/sources/environment packages/happy-app/sources/hooks
git commit -m "feat(app): model multi-component environment health"
```

### Task 7: Render the development environment health UI

**Files:**
- Modify: `packages/happy-app/sources/components/environment/DeviceEnvironmentView.tsx`
- Modify: `packages/happy-app/sources/components/environment/DeviceEnvironmentView.test.tsx`
- Modify: `packages/happy-app/sources/components/DesktopDeviceEnvironmentModal.integration.test.tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify other translation files only when required by the fallback/type contract.

**Interfaces:**
- Consumes `FleetRow.components`.
- Produces test IDs `environment-component-${machineId}-${componentId}`.

- [ ] **Step 1: Write failing component tests for ENV-01 through ENV-08**

Assert five component rows, offline skipped state, Paws versions, Ego runtime/mismatch, sanitized Wrangler account state, cloudflared certificate state, component-local failures, unchanged GitHub confirmation, and no inspect-only alignment buttons.

- [ ] **Step 2: Verify RED**

Run: `pnpm --dir packages/happy-app vitest run sources/components/environment/DeviceEnvironmentView.test.tsx sources/components/DesktopDeviceEnvironmentModal.integration.test.tsx`

Expected: FAIL because the view renders one GitHub block per machine.

- [ ] **Step 3: Implement compact component rows and copy**

Render each machine once with five child rows, status icons, installed/latest or paired version, auth/runtime summary, reason, and static repair commands. Keep one scan action and component-specific preview/apply actions.

- [ ] **Step 4: Verify GREEN and app typecheck**

Run Step 2, then `pnpm --dir packages/happy-app typecheck`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/happy-app/sources/components packages/happy-app/sources/text
git commit -m "feat(app): show multi-tool device environment health"
```

### Task 8: Full verification, independent review, and visual delivery

**Files:**
- Modify only files required by confirmed review findings.
- Create stable screenshots/video under an existing ignored artifact location.

**Interfaces:**
- Produces Case evidence for ENV-01 through ENV-08 and PR-ready Before/After assets.

- [ ] **Step 1: Run complete affected suites**

```bash
pnpm --dir packages/happy-wire test
pnpm --dir packages/happy-cli test
pnpm --dir packages/happy-app vitest run sources/environment/fleetModel.test.ts sources/hooks/useDeviceEnvironment.test.ts sources/components/environment/DeviceEnvironmentView.test.tsx sources/components/DesktopDeviceEnvironmentModal.integration.test.tsx
pnpm --dir packages/happy-app typecheck
```

- [ ] **Step 2: Run diff hygiene checks**

```bash
git diff --check main...HEAD
git status --short
```

- [ ] **Step 3: Obtain independent code review**

Review `main...HEAD` against the spec and eight Cases. Any confirmed finding gets a new failing regression test before its fix.

- [ ] **Step 4: Capture matched Before and After desktop evidence**

Use the same viewport and DPR. Before is base `b7e64bb466749a9bbaac5e8b57c47efbce793eee`; After is final HEAD. Include one ready, one warning, and one offline machine.

- [ ] **Step 5: Run one-to-one browser E2E and interaction review**

Verify scan feedback, five rows, Paws preview confirmation, inspect-only non-actionability, keyboard focus, scrolling, and modal close. Record a final passing MP4 and screenshot.

- [ ] **Step 6: Deliver visual evidence through Happy**

Send the PNG/JPEG with `mcp__happy__send_image` and verified MP4 with `mcp__happy__send_file`; mark delivery `sent` only after both succeed.

- [ ] **Step 7: Commit only confirmed final fixes**

```bash
git add -u
git commit -m "fix: address environment health review findings"
```

Skip Step 7 if review produces no fixes.
