# Happy Device Environment: GitHub CLI PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Happy App screen that inspects GitHub CLI across all registered machines, previews one exact fleet-alignment plan, broadcasts the approved install or upgrade through typed machine RPC, verifies every result, and provides SSH rescue guidance for nonstandard cases.

**Architecture:** Shared Zod contracts live in `happy-wire`; the CLI daemon owns a strict component registry and the macOS/Homebrew GitHub CLI adapter; the App coordinates encrypted RPC calls to online machines with `Promise.allSettled`. The Happy Server remains an opaque RPC relay in the PoC, so there is no server schema migration, persistent job, offline queue, credential transfer, or arbitrary shell input.

**Tech Stack:** TypeScript 5.9, Zod 4, Node `child_process.spawn`, Vitest, React Native + Expo Router, React Native Unistyles, existing encrypted machine-scoped Socket.IO RPC.

**Spec:** `docs/superpowers/specs/2026-09-05-device-environment-gh-poc-design.md`

## Global Constraints

- Normal inspection and remediation use encrypted machine-scoped RPC; SSH is guidance and rescue only.
- The PoC supports online `darwin`/`arm64` machines and Homebrew-managed `gh` only.
- Every mutating operation requires an unexpired daemon-generated plan that the App displays before one explicit user confirmation.
- The App never sends an executable, command, argument list, environment map, package name, or script to the daemon.
- Authentication is status-only: never read, copy, return, log, or persist GitHub tokens or raw auth configuration.
- `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, and `GITHUB_ENTERPRISE_TOKEN` must be removed while inspecting persistent authentication.
- Apply operations are idempotent, serialized per component, reject downgrades, recheck preconditions, and verify final state independently.
- Fleet calls preserve partial results; one offline or failed machine never erases successful rows.
- The root repository stays clean. All code, tests, evidence, and commits remain in `/Users/jacky/jacky-github/happy--device-environment-gh-poc` on `feat/device-environment-gh-poc`.
- User-visible colors come only from semantic Unistyles theme tokens; no hardcoded colors.
- Browser verification uses Ego Browser only. Every meaningful verified browser round must be screenshotted and reported to Happy before the next round.
- Do not publish npm, deploy production Web, publish OTA, merge the PR, or change a remote machine runtime without a separate explicit rollout decision.

---

### Task 1: Shared environment wire contract

**Files:**
- Create: `packages/happy-wire/src/environment.ts`
- Create: `packages/happy-wire/src/environment.test.ts`
- Modify: `packages/happy-wire/src/index.ts`

**Interfaces:**
- Consumes: Zod 4 and the package's existing named-export convention.
- Produces: `EnvironmentComponentId`, `EnvironmentReasonCode`, `DesiredComponentState`, `ComponentObservation`, `ComponentPlan`, `RepairGuide`, `ComponentApplyResult`, `EnvironmentInspectRequest`, `EnvironmentInspectResponse`, `EnvironmentApplyRequest`, and `EnvironmentApplyResponse`, plus matching `*Schema` exports.

- [ ] **Step 1: Write failing strict-schema tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  EnvironmentApplyRequestSchema,
  EnvironmentInspectRequestSchema,
} from './environment';

describe('environment wire schemas', () => {
  it('accepts a bounded scan and an optional desired state', () => {
    expect(EnvironmentInspectRequestSchema.parse({ componentIds: ['github-cli'] })).toEqual({
      componentIds: ['github-cli'],
    });
    expect(EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli'],
      desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
    }).desired?.targetVersion).toBe('2.80.0');
  });

  it('rejects arbitrary execution fields and oversized component arrays', () => {
    expect(() => EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli', 'github-cli'],
    })).toThrow();
    expect(() => EnvironmentApplyRequestSchema.parse({
      desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
      approvedAt: 1,
      plan: {
        componentId: 'github-cli',
        action: 'upgrade',
        fromVersion: '2.79.0',
        targetVersion: '2.80.0',
        planFingerprint: 'a'.repeat(64),
        expiresAt: 601_000,
      },
      command: 'rm -rf /',
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the wire test and verify the missing-module failure**

Run: `pnpm --filter @slopus/happy-wire exec vitest run src/environment.test.ts`

Expected: FAIL because `./environment` does not exist.

- [ ] **Step 3: Implement strict schemas and inferred types**

Create `environment.ts` with `.strict()` on every request and nested object that crosses RPC. Use these exact unions and field names:

```ts
import { z } from 'zod';

export const EnvironmentComponentIdSchema = z.enum(['github-cli']);
export type EnvironmentComponentId = z.infer<typeof EnvironmentComponentIdSchema>;

export const EnvironmentReasonCodeSchema = z.enum([
  'machine-offline', 'unsupported-platform', 'unsupported-architecture',
  'homebrew-missing', 'formula-unavailable', 'version-source-mismatch',
  'version-ahead', 'authentication-missing', 'operation-in-progress',
  'plan-stale', 'install-failed', 'verification-failed', 'rpc-timeout',
  'unexpected-error',
]);
export type EnvironmentReasonCode = z.infer<typeof EnvironmentReasonCodeSchema>;

export const DesiredComponentStateSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  targetVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u),
}).strict();

export const ComponentObservationSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  platform: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64),
  support: z.enum(['supported', 'unsupported']),
  installed: z.boolean(),
  installedVersion: z.string().nullable(),
  resolvedExecutable: z.string().max(4096).nullable(),
  packageManager: z.object({
    kind: z.literal('homebrew'),
    available: z.boolean(),
    stableVersion: z.string().nullable(),
  }).strict(),
  authentication: z.object({
    provider: z.literal('github.com'),
    status: z.enum(['authenticated', 'missing', 'unknown']),
  }).strict(),
  inspectedAt: z.number().int().nonnegative(),
  reasonCode: EnvironmentReasonCodeSchema.optional(),
}).strict();

export const ComponentPlanSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  action: z.enum(['none', 'install', 'upgrade', 'manual-repair']),
  fromVersion: z.string().nullable(),
  targetVersion: z.string().nullable(),
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  expiresAt: z.number().int().positive(),
  reasonCode: EnvironmentReasonCodeSchema.optional(),
}).strict();

export const RepairGuideSchema = z.object({
  channel: z.enum(['ssh', 'local-terminal']),
  reasonCode: EnvironmentReasonCodeSchema,
  commands: z.array(z.string().min(1).max(512)).max(3),
}).strict();

export const ComponentApplyResultSchema = z.object({
  componentId: EnvironmentComponentIdSchema,
  status: z.enum(['succeeded', 'failed', 'stale-plan', 'manual-repair']),
  before: ComponentObservationSchema,
  after: ComponentObservationSchema,
  changed: z.boolean(),
  reasonCode: EnvironmentReasonCodeSchema.optional(),
  repairGuide: RepairGuideSchema.optional(),
  diagnosticSummary: z.string().max(2048).optional(),
}).strict();

export const EnvironmentInspectRequestSchema = z.object({
  componentIds: z.array(EnvironmentComponentIdSchema).min(1).max(1),
  desired: DesiredComponentStateSchema.optional(),
}).strict();

export const EnvironmentInspectResponseSchema = z.object({
  observations: z.array(ComponentObservationSchema).max(1),
  plans: z.array(ComponentPlanSchema).max(1).optional(),
}).strict();

export const EnvironmentApplyRequestSchema = z.object({
  desired: DesiredComponentStateSchema,
  plan: ComponentPlanSchema,
  approvedAt: z.number().int().nonnegative(),
}).strict();

export const EnvironmentApplyResponseSchema = z.object({
  result: ComponentApplyResultSchema,
}).strict();

export type DesiredComponentState = z.infer<typeof DesiredComponentStateSchema>;
export type ComponentObservation = z.infer<typeof ComponentObservationSchema>;
export type ComponentPlan = z.infer<typeof ComponentPlanSchema>;
export type RepairGuide = z.infer<typeof RepairGuideSchema>;
export type ComponentApplyResult = z.infer<typeof ComponentApplyResultSchema>;
export type EnvironmentInspectRequest = z.infer<typeof EnvironmentInspectRequestSchema>;
export type EnvironmentInspectResponse = z.infer<typeof EnvironmentInspectResponseSchema>;
export type EnvironmentApplyRequest = z.infer<typeof EnvironmentApplyRequestSchema>;
export type EnvironmentApplyResponse = z.infer<typeof EnvironmentApplyResponseSchema>;
```

Export the module from `src/index.ts` with `export * from './environment';`.

- [ ] **Step 4: Run wire tests and typecheck**

Run: `pnpm --filter @slopus/happy-wire exec vitest run src/environment.test.ts && pnpm --filter @slopus/happy-wire run typecheck`

Expected: PASS with both strict-schema tests green and no TypeScript errors.

- [ ] **Step 5: Commit the shared contract**

```bash
git add packages/happy-wire/src/environment.ts packages/happy-wire/src/environment.test.ts packages/happy-wire/src/index.ts
git commit -m "feat(environment): define fleet component protocol"
```

---

### Task 2: Bounded process runner

**Files:**
- Create: `packages/happy-cli/src/environment/processRunner.ts`
- Create: `packages/happy-cli/src/environment/processRunner.test.ts`

**Interfaces:**
- Consumes: Node `spawn`, `access`, `constants.X_OK`, and platform path delimiters.
- Produces: `ProcessRunner`, `ProcessResult`, `RunProcessOptions`, `createProcessRunner()`, and `resolveExecutable(name, envPath, candidates)`.

- [ ] **Step 1: Write failing runner tests**

```ts
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProcessRunner, resolveExecutable } from './processRunner';

describe('environment process runner', () => {
  it('uses argument arrays and returns bounded stdout', async () => {
    const runner = createProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'process.stdout.write("ready")'], {
      timeoutMs: 2_000,
      maxOutputBytes: 1024,
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ready', timedOut: false });
  });

  it('kills commands at the hard deadline', async () => {
    const runner = createProcessRunner();
    const result = await runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], {
      timeoutMs: 20,
      maxOutputBytes: 1024,
    });
    expect(result.timedOut).toBe(true);
  });

  it('resolves only executable files from explicit paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'paws-env-runner-'));
    const executable = join(directory, 'tool');
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o755);
    await expect(resolveExecutable('tool', directory, [])).resolves.toBe(executable);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/processRunner.test.ts`

Expected: FAIL because `processRunner.ts` does not exist.

- [ ] **Step 3: Implement the no-shell runner**

Use this public contract and implement output capping for stdout and stderr independently:

```ts
export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunProcessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
};

export type ProcessRunner = {
  run(executable: string, args: readonly string[], options: RunProcessOptions): Promise<ProcessResult>;
};
```

`createProcessRunner().run()` must call `spawn(executable, [...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], cwd, env })`, terminate on deadline, and return `timedOut: true`. `resolveExecutable()` must inspect `PATH` entries plus fixed candidates with `fs.access(X_OK)` and return `null` when none are executable.

- [ ] **Step 4: Run the runner tests**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/processRunner.test.ts`

Expected: PASS with execution, timeout, and executable-resolution cases green.

- [ ] **Step 5: Commit the runner**

```bash
git add packages/happy-cli/src/environment/processRunner.ts packages/happy-cli/src/environment/processRunner.test.ts
git commit -m "feat(environment): add bounded process runner"
```

---

### Task 3: GitHub CLI component adapter

**Files:**
- Create: `packages/happy-cli/src/environment/componentAdapter.ts`
- Create: `packages/happy-cli/src/environment/githubCliAdapter.ts`
- Create: `packages/happy-cli/src/environment/githubCliAdapter.test.ts`

**Interfaces:**
- Consumes: Task 1 wire types and Task 2 `ProcessRunner`/`resolveExecutable`.
- Produces: `EnvironmentComponentAdapter`, `GitHubCliAdapterDeps`, `createGitHubCliAdapter(deps)`, and parsing helpers `parseGitHubCliVersion()` and `parseHomebrewStableVersion()`.

- [ ] **Step 1: Write failing inspection and planning tests**

Use a deterministic queued `ProcessRunner` test double; do not mock Node modules. Cover these exact assertions:

```ts
it('reports installed version, Homebrew target, and stored auth without leaking output', async () => {
  const adapter = createGitHubCliAdapter(testDeps({
    ghVersion: { exitCode: 0, stdout: 'gh version 2.80.0 (2026-08-20)\n', stderr: '', timedOut: false },
    brewInfo: { exitCode: 0, stdout: '{"formulae":[{"versions":{"stable":"2.80.0"}}]}', stderr: '', timedOut: false },
    authStatus: { exitCode: 0, stdout: 'logged in as private-user', stderr: '', timedOut: false },
  }));
  const observed = await adapter.inspect();
  expect(observed.installedVersion).toBe('2.80.0');
  expect(observed.packageManager.stableVersion).toBe('2.80.0');
  expect(observed.authentication.status).toBe('authenticated');
  expect(JSON.stringify(observed)).not.toContain('private-user');
});

it('plans install, upgrade, no-op, and ahead-of-target without downgrade', async () => {
  expect(adapter.plan(desired('2.80.0'), observation(null, '2.80.0')).action).toBe('install');
  expect(adapter.plan(desired('2.80.0'), observation('2.79.0', '2.80.0')).action).toBe('upgrade');
  expect(adapter.plan(desired('2.80.0'), observation('2.80.0', '2.80.0')).action).toBe('none');
  expect(adapter.plan(desired('2.80.0'), observation('2.81.0', '2.80.0'))).toMatchObject({
    action: 'manual-repair', reasonCode: 'version-ahead',
  });
});
```

In the same test file, define `desired(version)` as a wire-valid `DesiredComponentState`, `observation(installedVersion, stableVersion)` as a complete supported `ComponentObservation`, and `testDeps(results)` as a `GitHubCliAdapterDeps` whose queued runner records every executable, argument array, and environment. The fixture clock is fixed at `1_000`, platform at `darwin`, and architecture at `arm64`, so fingerprints and expiry assertions are deterministic.

Also assert that the auth invocation receives an environment without the four token variables from Global Constraints.

- [ ] **Step 2: Run adapter tests and verify failure**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/githubCliAdapter.test.ts`

Expected: FAIL because the adapter files do not exist.

- [ ] **Step 3: Define the adapter interface**

```ts
export interface EnvironmentComponentAdapter {
  readonly id: EnvironmentComponentId;
  inspect(): Promise<ComponentObservation>;
  plan(desired: DesiredComponentState, observed: ComponentObservation, now: number): ComponentPlan;
  apply(approvedPlan: ComponentPlan): Promise<ProcessResult>;
}
```

The adapter's `apply()` returns only the fixed package operation result. Task 4 owns locking, stale-plan validation, post-apply inspection, and conversion to `ComponentApplyResult`.

- [ ] **Step 4: Implement inspection and deterministic planning**

Implement these fixed rules:

```ts
const INSPECT_TIMEOUT_MS = 15_000;
const APPLY_TIMEOUT_MS = 8 * 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const PLAN_TTL_MS = 10 * 60_000;
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
```

- Reject platforms other than `darwin` with `unsupported-platform`.
- Reject architectures other than `arm64` with `unsupported-architecture`.
- Resolve `brew` from PATH and `BREW_CANDIDATES`; missing brew is `homebrew-missing`.
- Resolve `gh` from PATH plus `<brew-prefix>/bin/gh` when available.
- Parse `gh version X.Y.Z` from the first output line.
- Parse `formulae[0].versions.stable` from `brew info --json=v2 gh`.
- Run persistent auth inspection with `[ghPath, ['auth', 'status', '--hostname', 'github.com']]` and the sanitized environment.
- Return only the auth status enum; discard raw auth stdout/stderr.
- Produce a SHA-256 fingerprint over canonical JSON containing `componentId`, desired target, installed version, resolved executable, Homebrew availability, and Homebrew stable version.
- Set `expiresAt` to `now + PLAN_TTL_MS`.
- `apply()` runs only `brew install gh`, `brew upgrade gh`, or no command with `HOMEBREW_NO_AUTO_UPDATE=1`; it throws for `manual-repair` and never accepts caller-supplied arguments.

- [ ] **Step 5: Run adapter tests and CLI typecheck**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/githubCliAdapter.test.ts && pnpm --filter @wangjs-jacky/paws exec tsc --noEmit`

Expected: PASS with no credential text in observations and all plan actions correct.

- [ ] **Step 6: Commit the adapter**

```bash
git add packages/happy-cli/src/environment/componentAdapter.ts packages/happy-cli/src/environment/githubCliAdapter.ts packages/happy-cli/src/environment/githubCliAdapter.test.ts
git commit -m "feat(environment): add github cli adapter"
```

---

### Task 4: Registry, apply service, and safety gates

**Files:**
- Create: `packages/happy-cli/src/environment/environmentService.ts`
- Create: `packages/happy-cli/src/environment/environmentService.test.ts`

**Interfaces:**
- Consumes: `EnvironmentComponentAdapter` and all Task 1 request/response types.
- Produces: `EnvironmentService`, `createEnvironmentService(adapters, now)`, `inspect(request)`, and `apply(request)`.

- [ ] **Step 1: Write failing service tests**

```ts
it('re-inspects and rejects an expired or changed plan before mutation', async () => {
  const service = serviceWithAdapter(adapterFixture({ installedVersion: '2.79.0' }), () => 700_001);
  const response = await service.apply(applyRequest({ expiresAt: 700_000 }));
  expect(response.result.status).toBe('stale-plan');
  expect(response.result.reasonCode).toBe('plan-stale');
  expect(adapter.apply).not.toHaveBeenCalled();
});

it('serializes apply per component and returns operation-in-progress', async () => {
  const first = service.apply(validApplyRequest());
  const second = await service.apply(validApplyRequest());
  expect(second.result).toMatchObject({ status: 'failed', reasonCode: 'operation-in-progress' });
  releaseApply();
  await first;
});

it('verifies exact target after mutation and is idempotent on the next run', async () => {
  const first = await service.apply(validApplyRequest());
  expect(first.result).toMatchObject({ status: 'succeeded', changed: true });
  const preview = await service.inspect(inspectRequestWithDesired('2.80.0'));
  expect(preview.plans?.[0].action).toBe('none');
});
```

Define the service fixtures in the same test file: `adapterFixture()` returns an `EnvironmentComponentAdapter` with recorded `inspect`, `plan`, and `apply` calls; `serviceWithAdapter(adapter, now)` passes exactly that adapter to `createEnvironmentService`; `validApplyRequest()` is a wire-valid `github-cli` upgrade request; and `releaseApply()` resolves the first adapter apply promise. Use `vi.fn` only for these injected interface methods, not for Node process modules.

- [ ] **Step 2: Run the service test and verify failure**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/environmentService.test.ts`

Expected: FAIL because `environmentService.ts` does not exist.

- [ ] **Step 3: Implement registry lookup, preview, locking, and verification**

Use a `Map<EnvironmentComponentId, EnvironmentComponentAdapter>` and a `Set<EnvironmentComponentId>` for in-flight apply operations. Implement this sequence exactly:

```ts
async apply(request: EnvironmentApplyRequest): Promise<EnvironmentApplyResponse> {
  const adapter = requireAdapter(request.desired.componentId);
  if (inFlight.has(adapter.id)) return operationInProgressResult(request);
  inFlight.add(adapter.id);
  try {
    const before = await adapter.inspect();
    const currentPlan = adapter.plan(request.desired, before, now());
    if (request.plan.expiresAt < now() || currentPlan.planFingerprint !== request.plan.planFingerprint) {
      return stalePlanResult(before);
    }
    if (currentPlan.action === 'manual-repair') return manualRepairResult(before, currentPlan);
    const processResult = await adapter.apply(currentPlan);
    const after = await adapter.inspect();
    return verifiedApplyResult(before, after, currentPlan, processResult);
  } finally {
    inFlight.delete(adapter.id);
  }
}
```

`verifiedApplyResult` succeeds only when `after.installedVersion === currentPlan.targetVersion`. Cap diagnostic summaries at 2048 characters, use fixed repair commands per reason code, and never include raw environment data.

- [ ] **Step 4: Run service and adapter tests**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/environmentService.test.ts src/environment/githubCliAdapter.test.ts`

Expected: PASS with stale-plan, lock, verification, idempotence, and manual-repair behavior green.

- [ ] **Step 5: Commit the environment service**

```bash
git add packages/happy-cli/src/environment/environmentService.ts packages/happy-cli/src/environment/environmentService.test.ts
git commit -m "feat(environment): enforce safe component apply"
```

---

### Task 5: Register typed machine RPC handlers

**Files:**
- Create: `packages/happy-cli/src/environment/registerEnvironmentHandlers.ts`
- Create: `packages/happy-cli/src/environment/registerEnvironmentHandlers.test.ts`
- Modify: `packages/happy-cli/src/api/apiMachine.ts`
- Modify: `packages/happy-cli/src/api/apiMachine.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and Task 4 `EnvironmentService`.
- Produces: `registerEnvironmentHandlers(registrar, service)` and machine methods `environment-inspect` / `environment-apply`.

- [ ] **Step 1: Write failing handler-validation tests**

```ts
it('registers typed inspect and apply handlers', async () => {
  const handlers = new Map<string, (value: unknown) => Promise<unknown>>();
  registerEnvironmentHandlers({
    registerHandler: (name, handler) => handlers.set(name, handler),
  }, service);
  expect([...handlers.keys()]).toEqual(['environment-inspect', 'environment-apply']);
  await expect(handlers.get('environment-inspect')?.({ componentIds: ['github-cli'] }))
    .resolves.toEqual(inspectResponse);
});

it('rejects arbitrary command fields before calling the service', async () => {
  await expect(applyHandler({ ...validApplyRequest, command: 'whoami' })).rejects.toThrow();
  expect(service.apply).not.toHaveBeenCalled();
});
```

Capture `inspectHandler` and `applyHandler` from the registrar map before each assertion. Define `validApplyRequest` as the same strict request fixture used by the service tests and use an injected service object with recorded `inspect` and `apply` methods.

- [ ] **Step 2: Run handler tests and verify failure**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/registerEnvironmentHandlers.test.ts`

Expected: FAIL because the registration module does not exist.

- [ ] **Step 3: Implement strict registration and wire it into `ApiMachineClient`**

```ts
export function registerEnvironmentHandlers(
  registrar: Pick<RpcHandlerManager, 'registerHandler'>,
  service: EnvironmentService,
): void {
  registrar.registerHandler('environment-inspect', async (raw: unknown) =>
    service.inspect(EnvironmentInspectRequestSchema.parse(raw)));
  registrar.registerHandler('environment-apply', async (raw: unknown) =>
    service.apply(EnvironmentApplyRequestSchema.parse(raw)));
}
```

Create the production process runner, GitHub CLI adapter, and environment service once in the `ApiMachineClient` constructor, then register the handlers beside `registerCommonHandlers`. Update `apiMachine.test.ts` to assert the new registrar is called without weakening existing reconnection coverage.

- [ ] **Step 4: Run handler and machine-client tests**

Run: `pnpm --filter @wangjs-jacky/paws exec vitest run src/environment/registerEnvironmentHandlers.test.ts src/api/apiMachine.test.ts`

Expected: PASS, including strict rejection of `command`, `executable`, and extra component IDs.

- [ ] **Step 5: Commit the RPC integration**

```bash
git add packages/happy-cli/src/environment/registerEnvironmentHandlers.ts packages/happy-cli/src/environment/registerEnvironmentHandlers.test.ts packages/happy-cli/src/api/apiMachine.ts packages/happy-cli/src/api/apiMachine.test.ts
git commit -m "feat(environment): expose typed machine operations"
```

---

### Task 6: App RPC client and fleet state model

**Files:**
- Create: `packages/happy-app/sources/environment/environmentOps.ts`
- Create: `packages/happy-app/sources/environment/fleetModel.ts`
- Create: `packages/happy-app/sources/environment/fleetModel.test.ts`
- Create: `packages/happy-app/sources/environment/useDeviceEnvironment.ts`
- Create: `packages/happy-app/sources/environment/useDeviceEnvironment.test.ts`

**Interfaces:**
- Consumes: Task 1 wire types, `apiSocket.machineRPC`, `Machine`, and `isMachineOnline`.
- Produces: `inspectMachineEnvironment()`, `applyMachineEnvironment()`, `resolveFleetTarget()`, `buildFleetRows()`, and `useDeviceEnvironment()`.

- [ ] **Step 1: Write failing pure fleet-model tests**

```ts
it('resolves one common target while keeping offline machines visible', () => {
  const result = resolveFleetTarget([
    scanned('air', '2.80.0'),
    scanned('mini-1', '2.80.0'),
    offline('mini-2'),
  ]);
  expect(result).toEqual({ kind: 'ready', targetVersion: '2.80.0' });
});

it('blocks mutation when online machines disagree on the Homebrew target', () => {
  expect(resolveFleetTarget([
    scanned('air', '2.80.0'),
    scanned('mini', '2.81.0'),
  ])).toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
});

it('keeps success and repair rows when another machine fails', () => {
  const rows = buildFleetRows(machines, settledResults);
  expect(rows.map((row) => row.status)).toEqual(['ready', 'manual-repair', 'rpc-error']);
});
```

Define `scanned(machineId, stableVersion)`, `offline(machineId)`, `machines`, and `settledResults` as complete `FleetMachineScan` fixtures in the test file. The fixture order is explicit and the production model must preserve that order.

- [ ] **Step 2: Run model tests and verify failure**

Run: `pnpm --filter happy-app exec vitest run sources/environment/fleetModel.test.ts`

Expected: FAIL because the fleet modules do not exist.

- [ ] **Step 3: Implement typed RPC wrappers**

```ts
const APPLY_RPC_TIMEOUT_MS = 10 * 60_000;

export function inspectMachineEnvironment(machineId: string, request: EnvironmentInspectRequest) {
  return apiSocket.machineRPC<EnvironmentInspectResponse, EnvironmentInspectRequest>(
    machineId, 'environment-inspect', request,
  );
}

export function applyMachineEnvironment(machineId: string, request: EnvironmentApplyRequest) {
  return apiSocket.machineRPC<EnvironmentApplyResponse, EnvironmentApplyRequest>(
    machineId, 'environment-apply', request, { timeoutMs: APPLY_RPC_TIMEOUT_MS },
  );
}
```

The wrappers parse responses through Task 1 schemas before returning them. Convert timeout exceptions to the stable `rpc-timeout` row state without claiming the remote process failed.

- [ ] **Step 4: Implement the fleet hook as an explicit state machine**

Use these states and transitions:

```ts
type FleetPhase = 'idle' | 'scanning' | 'scanned' | 'previewing' | 'previewed' | 'applying' | 'completed';

type DeviceEnvironmentController = {
  phase: FleetPhase;
  rows: FleetRow[];
  target: FleetTarget;
  scan(): Promise<void>;
  preview(): Promise<void>;
  applyApproved(): Promise<void>;
  reset(): void;
};
```

- `scan()` builds rows for every registered machine, calls only online machines, and uses `Promise.allSettled`.
- `preview()` requires a ready common target and performs a second inspect with desired state so daemons generate the plans.
- `applyApproved()` sends only daemon-generated `install` and `upgrade` plans; no-op and manual-repair rows remain visible.
- A plan older than ten minutes returns the controller to `scanned` and requires preview again.
- State updates use functional React setters so late results cannot overwrite a newer scan.

- [ ] **Step 5: Test phase transitions and apply timeout selection**

Use injected inspect/apply functions in the hook test. Assert `idle → scanning → scanned → previewing → previewed → applying → completed`, partial failures, duplicate-apply suppression, and the ten-minute timeout argument.

Run: `pnpm --filter happy-app exec vitest run sources/environment/fleetModel.test.ts sources/environment/useDeviceEnvironment.test.ts sources/sync/apiSocket.test.ts`

Expected: PASS with existing API socket tests unchanged.

- [ ] **Step 6: Commit the App environment model**

```bash
git add packages/happy-app/sources/environment
git commit -m "feat(environment): coordinate fleet alignment"
```

---

### Task 7: Device Environment screen and navigation

**Files:**
- Create: `packages/happy-app/sources/app/(app)/settings/device-environment.tsx`
- Create: `packages/happy-app/sources/components/environment/DeviceEnvironmentView.tsx`
- Create: `packages/happy-app/sources/components/environment/DeviceEnvironmentView.test.tsx`
- Modify: `packages/happy-app/sources/components/SettingsView.tsx`
- Modify: `packages/happy-app/sources/components/DesktopSettingsModal.tsx`
- Modify: `packages/happy-app/sources/text/_default.ts`
- Modify: `packages/happy-app/sources/text/translations/en.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hans.ts`
- Modify: `packages/happy-app/sources/text/translations/zh-Hant.ts`
- Modify: `packages/happy-app/sources/text/translations/ca.ts`
- Modify: `packages/happy-app/sources/text/translations/es.ts`
- Modify: `packages/happy-app/sources/text/translations/it.ts`
- Modify: `packages/happy-app/sources/text/translations/ja.ts`
- Modify: `packages/happy-app/sources/text/translations/pl.ts`
- Modify: `packages/happy-app/sources/text/translations/pt.ts`
- Modify: `packages/happy-app/sources/text/translations/ru.ts`
- Modify: `packages/happy-app/sources/components/DesktopSettingsModal.test.tsx`

**Interfaces:**
- Consumes: Task 6 `useDeviceEnvironment()`, existing `Item`, `ItemGroup`, `Modal.confirm`, Expo Router, and semantic theme tokens.
- Produces: `/settings/device-environment` on native and inside the desktop settings modal.

- [ ] **Step 1: Write failing view tests for the visible cases**

```ts
it('renders connectivity, version, and authentication as separate states', () => {
  const view = renderEnvironmentView({
    rows: [readyAuthenticated, readyAuthMissing, offlineMachine],
    phase: 'scanned',
  });
  expect(view.root.findByProps({ testID: 'environment-summary' }).props.children).toContain('2/3');
  expect(view.root.findByProps({ testID: 'environment-row-ready-authenticated' })).toBeTruthy();
  expect(view.root.findByProps({ testID: 'environment-row-ready-auth-missing' })).toBeTruthy();
  expect(view.root.findByProps({ testID: 'environment-row-offline' })).toBeTruthy();
});

it('requires confirmation before calling applyApproved', async () => {
  confirmation.resolve(false);
  await pressPreviewAndApply();
  expect(controller.applyApproved).not.toHaveBeenCalled();
  confirmation.resolve(true);
  await pressPreviewAndApply();
  expect(controller.applyApproved).toHaveBeenCalledOnce();
});
```

Build `renderEnvironmentView()` with the repository's existing React test renderer, inject a complete `DeviceEnvironmentController`, and expose recorded `scan`, `preview`, and `applyApproved` methods. `confirmation.resolve(value)` controls the injected `Modal.confirm` promise so the test observes both cancel and approve paths without native dialogs.

- [ ] **Step 2: Run view tests and verify failure**

Run: `pnpm --filter happy-app exec vitest run sources/components/environment/DeviceEnvironmentView.test.tsx sources/components/DesktopSettingsModal.test.tsx`

Expected: FAIL because the new view and route mapping do not exist.

- [ ] **Step 3: Add the route to native and desktop settings**

Add a Settings item titled `t('deviceEnvironment.title')` with a static capability-management subtitle and `desktop-outline` icon. Route it to `/settings/device-environment`. Add the matching title, lazy import, and component mapping to `DesktopSettingsModal.tsx`. The route file exports `DeviceEnvironmentView` as its default component. Live fleet readiness appears only inside the Device Environment screen, avoiding background scans from Settings.

- [ ] **Step 4: Implement the responsive fleet screen**

The screen must render these stable test IDs:

```ts
const testIds = {
  summary: 'environment-summary',
  scan: 'environment-scan-all',
  preview: 'environment-preview-alignment',
  confirm: 'environment-confirm-alignment',
  row: (machineId: string) => `environment-machine-${machineId}`,
};
```

Use `ItemList`/`ItemGroup` for the responsive container. Each machine row shows:

- machine display name and daemon online/offline;
- installed and target `gh` versions;
- authentication status;
- planned or completed action; and
- repair guidance when present.

The preview confirmation body lists each machine and exact action. Use `Modal.confirm` with localized confirm/cancel text. Disable duplicate actions while scanning, previewing, or applying. Render timeout as “state unknown; scan again,” not “installation failed.”

- [ ] **Step 5: Add complete translation structure**

Add a `deviceEnvironment` subtree to `_default.ts` containing these keys:

```ts
{
  title, subtitle, fleetReady, scanAll, scanning, previewAlignment,
  confirmTitle, confirmMessage, confirmAction, applying, completed,
  githubCli, daemonOnline, daemonOffline, versionInstalled, versionTarget,
  authReady, authMissing, authUnknown, actionNone, actionInstall,
  actionUpgrade, actionManualRepair, repairWithSsh, scanAgain,
  stateUnknown, partialFailure, versionSourceMismatch, homebrewMissing,
  unsupportedMachine, operationInProgress, planExpired,
}
```

Provide polished English, Simplified Chinese, and Traditional Chinese copy. Use explicit English fallback values for the other seven locales in this PoC so every `TranslationStructure` remains complete; do not omit keys or weaken typing.

- [ ] **Step 6: Run view, modal, translation, and type tests**

Run:

```bash
pnpm --filter happy-app exec vitest run \
  sources/components/environment/DeviceEnvironmentView.test.tsx \
  sources/components/DesktopSettingsModal.test.tsx \
  sources/text/settingsVoiceTranslations.test.ts
pnpm --filter happy-app run typecheck
```

Expected: PASS with native route, desktop modal route, visible states, confirmation gate, and complete translation types.

- [ ] **Step 7: Commit the user interface**

```bash
git add packages/happy-app/sources/app/\(app\)/settings/device-environment.tsx \
  packages/happy-app/sources/components/environment \
  packages/happy-app/sources/components/SettingsView.tsx \
  packages/happy-app/sources/components/DesktopSettingsModal.tsx \
  packages/happy-app/sources/components/DesktopSettingsModal.test.tsx \
  packages/happy-app/sources/text
git commit -m "feat(environment): add device alignment screen"
```

---

### Task 8: Cross-package verification and visual evidence

**Files:**
- Create: `docs/pr-evidence/device-environment-gh-poc/README.md`
- Create: `docs/pr-evidence/device-environment-gh-poc/before-settings.png`
- Create: `docs/pr-evidence/device-environment-gh-poc/after-fleet-overview.png`
- Create: `docs/pr-evidence/device-environment-gh-poc/after-alignment-preview.png`
- Create: `docs/pr-evidence/device-environment-gh-poc/after-partial-result.png`
- Create: `docs/pr-evidence/device-environment-gh-poc/after-dark-theme.png`

**Interfaces:**
- Consumes: all prior tasks and the existing local app/Web development commands.
- Produces: verified build/test evidence and PR-ready visible-case documentation; it does not publish or deploy.

- [ ] **Step 1: Run focused cross-package tests**

```bash
pnpm --filter @slopus/happy-wire exec vitest run src/environment.test.ts
pnpm --filter @wangjs-jacky/paws exec vitest run \
  src/environment/processRunner.test.ts \
  src/environment/githubCliAdapter.test.ts \
  src/environment/environmentService.test.ts \
  src/environment/registerEnvironmentHandlers.test.ts \
  src/api/apiMachine.test.ts
pnpm --filter happy-app exec vitest run \
  sources/environment/fleetModel.test.ts \
  sources/environment/useDeviceEnvironment.test.ts \
  sources/components/environment/DeviceEnvironmentView.test.tsx \
  sources/components/DesktopSettingsModal.test.tsx \
  sources/sync/apiSocket.test.ts
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 2: Run builds and repository hygiene checks**

```bash
pnpm --filter @slopus/happy-wire run build
pnpm --filter @wangjs-jacky/paws run build
pnpm --filter happy-app run typecheck
git diff --check
```

Expected: all commands exit 0 and `git diff --check` prints nothing.

- [ ] **Step 3: Verify the real local adapter without mutation**

Run the adapter inspection through its test/debug entry point and compare only these values with direct commands:

```bash
gh --version
brew info --json=v2 gh
env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
  gh auth status --hostname github.com >/dev/null
```

Expected: installed version, stable version, and authentication enum match. Do not capture auth output or tokens in the evidence document.

- [ ] **Step 4: Capture each visible PC Web case with Ego Browser**

Start the local Web development build using the repository's existing command. Use Ego Browser only. Capture and report these meaningful verified rounds individually to Happy:

1. existing Settings before the feature entry;
2. fleet overview with online, auth-missing, and offline distinctions;
3. exact per-machine alignment preview before confirmation;
4. partial result with successful and repair-required machines retained; and
5. the fleet view under `ginghamDark`, including resting and pressed/selected surfaces.

Store the screenshots at the exact paths listed in this task. Do not reuse one screenshot for multiple visible cases.

- [ ] **Step 5: Write the PR evidence matrix**

The README must declare `Visible UI cases: 4` and include this mapping:

```markdown
| Case | Problem | Before | After |
|---|---|---|---|
| ENV-1 Fleet overview | Happy only showed daemon online/offline | before-settings.png | after-fleet-overview.png |
| ENV-2 Mutation preview | No exact fleet plan existed | before-settings.png | after-alignment-preview.png |
| ENV-3 Partial result | Multi-device failures could not be compared | before-settings.png | after-partial-result.png |
| ENV-4 Theme states | New surfaces require semantic dark-theme verification | before-settings.png | after-dark-theme.png |
```

The repeated Before image is explicitly shared because the prior product had no Device Environment route; every After image remains an independent capture.

- [ ] **Step 6: Commit verification evidence**

```bash
git add docs/pr-evidence/device-environment-gh-poc
git commit -m "test(environment): add fleet ui evidence"
```

---

### Task 9: Implementation review and rollout decision package

**Files:**
- Create: `docs/pr-evidence/device-environment-gh-poc/ROLLOUT.md`
- Modify: `.github/pull_request_template.md` only if the existing template cannot represent the required evidence; otherwise leave it unchanged.

**Interfaces:**
- Consumes: verified code and evidence from Tasks 1–8.
- Produces: a reviewed branch and an explicit, non-executing three-device rollout procedure.

- [ ] **Step 1: Request specification compliance review**

Review every spec section against the implementation and record pass/fail evidence in `ROLLOUT.md`. Required rows are: wire safety, no arbitrary shell input, auth redaction, plan expiry, stale-plan rejection, idempotence, lock behavior, partial results, UI confirmation, SSH guidance, and no server schema change.

- [ ] **Step 2: Request code-quality review**

Review process cleanup, output bounds, semver comparison, Homebrew parsing, React stale-result handling, test isolation, translation completeness, and semantic theme tokens. Fix every high- or medium-severity issue and rerun the focused tests.

- [ ] **Step 3: Document the gated three-device rollout**

Write these exact stages in `ROLLOUT.md` without executing them:

```text
1. Merge the reviewed PR through main.
2. Publish a normal Paws CLI version containing the two environment RPC handlers.
3. Upgrade one non-server Mac as canary; verify daemon reconnect and inspect RPC.
4. Upgrade the second non-server Mac; repeat verification.
5. Upgrade the Mac that hosts production Happy services last; do not restart the server.
6. Publish the compatible App OTA only after all three daemons expose the RPC.
7. Scan all three devices, approve an idempotent no-op if already aligned, and apply a real upgrade only when Homebrew exposes a common newer target.
8. Verify each result with direct local commands and a second Happy scan.
9. Roll back a failed CLI runtime using the preserved previous runtime, then use SSH rescue guidance.
```

State explicitly that npm publication, PR merge, remote daemon upgrades, and OTA require the user's separate rollout approval after code review.

- [ ] **Step 4: Run final branch verification**

```bash
git status --short
git log --oneline --decorate -12
git diff main...HEAD --check
git -C /Users/jacky/jacky-github/happy status --short --branch
git -C /Users/jacky/jacky-github/happy rev-parse HEAD
git -C /Users/jacky/jacky-github/happy rev-parse origin/main
```

Expected: the feature worktree is clean; the root workspace is clean `main` and equals `origin/main`.

- [ ] **Step 5: Commit the rollout decision package**

```bash
git add docs/pr-evidence/device-environment-gh-poc/ROLLOUT.md
git commit -m "docs(environment): define fleet rollout gates"
```

Implementation ends here. Present the tested branch, review findings, visible evidence, and rollout document to the user. Do not push, open or merge a PR, publish packages or OTA, or mutate remote runtimes until the user selects the rollout action.
