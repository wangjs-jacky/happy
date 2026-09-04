# Happy Device Environment: GitHub CLI PoC Design

**Date:** 2026-09-05
**Status:** Approved direction; implementation pending plan review

## 1. Purpose

Happy currently knows whether a machine daemon is connected, but it does not know whether the machine has the tools, versions, configuration, or authentication required to perform useful work. Operators compensate with ad hoc SSH commands and machine-specific knowledge.

This PoC adds the first vertical slice of a reusable device-environment system. It uses GitHub CLI (`gh`) to prove that Happy can:

1. inspect a standard capability across every online machine;
2. compare the observed state with one desired state;
3. preview a safe, explicit change plan;
4. broadcast an approved operation through existing machine RPC;
5. verify the result per machine; and
6. provide a specific SSH repair guide when the operation cannot be standardized.

The long-term product is a Happy-native desired-state layer for a trusted personal fleet. Standardizable components use typed local adapters. SSH remains the bootstrap and rescue path for unsupported cases or an unavailable daemon.

## 2. Decisions

- Normal inspection and remediation use Happy's encrypted machine-scoped RPC.
- Each daemon changes only its own machine. Devices do not recursively SSH into one another during normal operation.
- A user may initiate the operation from any Happy client that can access the account's machines.
- The App previews all planned mutations and requires one explicit confirmation before broadcasting them.
- The PoC supports online macOS machines only and uses Homebrew as the standardized `gh` installer.
- A successful alignment means every selected machine resolves the same Homebrew stable `gh` version and finishes on that exact version.
- Authentication is inspected but not copied in the PoC. Missing authentication produces a guided local login step.
- Unsupported or nonstandard states never fall through to arbitrary remote shell execution. They produce a typed repair result that identifies SSH as the rescue path.
- The PoC reuses existing RPC transport and storage. It does not add persistent server-side jobs or an offline queue.

## 3. Goals and non-goals

### Goals

- Add a reusable component adapter contract to the CLI daemon.
- Implement the first adapter for GitHub CLI on macOS.
- Distinguish daemon connectivity, tool installation, version compliance, and authentication health.
- Present a three-machine fleet summary and per-machine details in Happy App/Web.
- Support read-only fleet inspection and an idempotent install/upgrade operation.
- Preserve partial results when one machine is offline or fails.
- Return stable error codes and repair guidance instead of exposing raw command execution.
- Leave adapter and response types ready for future components such as Ego Browser and Happy CLI.

### Non-goals

- Copying GitHub tokens, browser sessions, Keychain entries, or other credentials.
- Downgrading `gh`.
- Supporting Windows, Linux, Intel macOS, Mac App Store software, or GUI application installation.
- Installing or updating Homebrew itself.
- Persisting jobs across App disconnects or queuing work for offline machines.
- Automatically opening SSH sessions or distributing SSH keys.
- General-purpose package management or arbitrary shell scripts.
- Updating the Happy daemon from inside itself.

## 4. Architecture

```text
Happy App/Web
  Environment screen + fleet coordinator
             |
             | encrypted machine RPC fan-out
             v
Happy Server (existing RPC relay; no new state)
             |
       +-----+-----+
       |     |     |
       v     v     v
    daemon daemon daemon
       |     |     |
       +-- local component adapter registry
                  |
                  +-- github-cli adapter
                        inspect / plan / apply / verify
```

The App is the short-lived coordinator in the PoC. It sends the same typed request to each selected online machine with `Promise.allSettled` semantics, updates rows independently, and never discards successful results because another machine failed.

The server continues to relay end-to-end encrypted RPC payloads. It does not read environment observations or plans and does not execute package operations.

The daemon owns all host-specific behavior. The App never assembles shell commands.

## 5. Shared domain model

The shared wire package defines strict schemas for environment operations. The initial component identifier is `github-cli`; future identifiers extend the enum deliberately.

```ts
type EnvironmentComponentId = 'github-cli';

type DesiredComponentState = {
  componentId: EnvironmentComponentId;
  targetVersion: string;
};

type ComponentObservation = {
  componentId: EnvironmentComponentId;
  platform: string;
  architecture: string;
  support: 'supported' | 'unsupported';
  installed: boolean;
  installedVersion: string | null;
  resolvedExecutable: string | null;
  packageManager: {
    kind: 'homebrew';
    available: boolean;
    stableVersion: string | null;
  };
  authentication: {
    provider: 'github.com';
    status: 'authenticated' | 'missing' | 'unknown';
  };
  inspectedAt: number;
  reasonCode?: EnvironmentReasonCode;
};

type ComponentPlan = {
  componentId: EnvironmentComponentId;
  action: 'none' | 'install' | 'upgrade' | 'manual-repair';
  fromVersion: string | null;
  targetVersion: string | null;
  planFingerprint: string;
  reasonCode?: EnvironmentReasonCode;
};

type ComponentApplyResult = {
  componentId: EnvironmentComponentId;
  status: 'succeeded' | 'failed' | 'stale-plan' | 'manual-repair';
  before: ComponentObservation;
  after: ComponentObservation;
  changed: boolean;
  reasonCode?: EnvironmentReasonCode;
  repairGuide?: RepairGuide;
};
```

`EnvironmentReasonCode` is a closed set in the PoC:

- `machine-offline`
- `unsupported-platform`
- `unsupported-architecture`
- `homebrew-missing`
- `formula-unavailable`
- `version-source-mismatch`
- `version-ahead`
- `authentication-missing`
- `operation-in-progress`
- `plan-stale`
- `install-failed`
- `verification-failed`
- `rpc-timeout`
- `unexpected-error`

The UI maps reason codes to localized text. Daemon stderr may be logged locally, but RPC responses return a bounded, sanitized diagnostic summary and never return environment variables or credential material.

## 6. Component adapter contract

The daemon contains a registry of explicitly supported adapters. The App may request only a registered component ID and action.

```ts
interface EnvironmentComponentAdapter<TDesired, TObservation> {
  readonly id: EnvironmentComponentId;
  inspect(): Promise<TObservation>;
  plan(desired: TDesired, observed: TObservation): ComponentPlan;
  apply(approvedPlan: ComponentPlan): Promise<ComponentApplyResult>;
}
```

Contract requirements:

- `inspect` is read-only and has a hard timeout.
- `plan` is deterministic for the same desired and observed state.
- `apply` is idempotent. Repeating an already successful request returns `changed: false`.
- `apply` re-runs inspection and verifies `planFingerprint` before mutation. A changed host state returns `stale-plan` and requires a new preview.
- The fingerprint covers the component ID, desired target, installed version, resolved executable, package-manager availability, and locally reported stable version. It excludes timestamps and authentication because neither changes the permitted package mutation.
- Only one apply operation per component may run on a daemon at a time.
- Every mutation is followed by an independent inspection; command exit code alone is not success.
- Commands use argument arrays through a process runner, never concatenated shell strings.

## 7. GitHub CLI adapter

### Inspection

The adapter checks:

1. platform and architecture;
2. whether `brew` is available;
3. which `gh` executable the daemon resolves;
4. installed `gh` version;
5. the locally available stable Homebrew formula version; and
6. stored GitHub authentication status for `github.com`.

Authentication inspection removes `GH_TOKEN`, `GITHUB_TOKEN`, and enterprise-token environment variables before invoking `gh auth status`. This ensures the observation represents persistent machine authentication rather than an inherited temporary token. The adapter reports only `authenticated`, `missing`, or `unknown`; it does not return tokens, scopes, or raw config files.

### Fleet target resolution

The App compares the `stableVersion` reported by every selected supported online machine.

- If all supported machines report the same non-null version, that exact version becomes the proposed target.
- If versions disagree, the App does not mutate any machine. It reports `version-source-mismatch` and provides an SSH repair guide to refresh Homebrew metadata before rescanning.
- If a machine is already newer than the common target, the adapter refuses to downgrade it and reports `version-ahead` for manual review.
- Machines without Homebrew or on an unsupported platform remain visible as `manual-repair` and are not included in the apply broadcast.

This rule prevents a nominal “upgrade to latest” action from leaving machines on different versions.

### Apply

For a valid approved plan, the adapter runs one of these fixed operations with Homebrew auto-update disabled:

- absent: `brew install gh`
- older than target: `brew upgrade gh`
- already at target: no operation

The adapter refuses downgrade plans and refuses to proceed when the current Homebrew stable version no longer equals the approved target. It then verifies the resolved executable and exact installed version.

Authentication remains a separate status. A successfully installed but unauthenticated machine is shown as “tool aligned; authentication required,” not as a failed installation.

## 8. RPC surface

The machine daemon registers two typed handlers:

- `environment-inspect`
- `environment-apply`

`environment-inspect` accepts a bounded array of registered component IDs and an optional desired component state. The PoC limit is one component. A scan without desired state returns observations only. After the App resolves one common stable target from the fleet, a second inspection includes that target and each daemon returns its own plan and fingerprint for preview. The App never creates or signs a mutation plan itself.

`environment-apply` accepts the desired state, the approved plan, and its fingerprint. It does not accept a command, executable path, package name, or environment-variable map.

The App calls inspection with the normal machine RPC timeout and apply with an explicit ten-minute acknowledgement timeout. A timeout marks that row as unknown rather than failed because the host operation may still be running. The user can rescan to recover the authoritative state.

## 9. User experience

Happy Settings gains a **Device Environment** entry. The first screen contains:

- a fleet summary such as “2 of 3 devices ready”;
- a GitHub CLI component card;
- one row per registered machine;
- distinct indicators for daemon connectivity, installed version, and GitHub authentication;
- **Scan all devices**;
- **Preview alignment** when drift exists; and
- a result panel after apply.

The confirmation sheet lists every selected machine and exact action:

```text
MacBook Air       No change       gh 2.x
Office Mac mini   Upgrade         gh 2.a -> 2.x
Remote Mac mini   Manual repair   Homebrew missing
```

One confirmation broadcasts only the listed install and upgrade actions. `manual-repair` devices are never silently skipped; the final summary includes them and exposes their repair guide.

The screen is responsive across Android, iOS, and PC Web and uses existing semantic theme tokens. Online status remains visually separate from environment readiness so a green daemon dot cannot imply that dependencies or authentication are healthy.

## 10. Repair and SSH fallback

A `RepairGuide` contains localized explanation keys and structured, component-owned steps. The current machine model has no canonical SSH alias, so the PoC identifies SSH as the rescue channel but does not synthesize a connection command. Adding verified SSH identity and topology is a later device-onboarding capability.

The PoC produces repair guidance for:

- an offline daemon: restore the device or use SSH to inspect it;
- missing Homebrew: install or repair Homebrew through an SSH session, then rescan;
- mismatched Homebrew metadata: refresh metadata through SSH, then rescan;
- missing GitHub authentication: open a terminal on the target device and run `gh auth login`;
- RPC timeout: wait for the package manager to finish, then rescan before retrying.

Happy does not execute these SSH steps automatically in the PoC. Future onboarding may attach verified SSH topology and guided remote execution to the same repair result.

## 11. Error handling and concurrency

- Fleet inspection and apply use per-machine `allSettled` aggregation.
- An offline machine is a visible result, not a fleet-level exception.
- A failure on one machine does not cancel successful work on another machine.
- Each daemon holds an in-memory component lock. A concurrent request returns `operation-in-progress`.
- Apply records bounded local logs with component, target version, duration, exit status, and verification result.
- Secrets, full environments, and raw auth files are excluded from logs and RPC responses.
- The confirmation plan expires after ten minutes. Expired or changed plans require a rescan.
- The App disables duplicate apply submission while a broadcast is active.

## 12. Testing strategy

### CLI unit tests

- Parse representative `gh --version`, Homebrew formula, and `gh auth status` outcomes.
- Cover absent, current, upgradeable, unsupported, unauthenticated, and malformed-command states.
- Use temporary executable fixtures and a real process runner instead of mocking system modules.
- Verify environment token variables are removed during auth inspection.
- Verify plan fingerprints reject time-of-check/time-of-use drift.
- Verify repeated apply is a no-op after success.
- Verify the component lock rejects a concurrent apply.

### RPC tests

- Validate accepted component IDs and reject unknown IDs or arbitrary command fields.
- Verify structured results survive encryption and machine RPC transport.
- Verify the App supplies the longer apply timeout.

### App model tests

- Aggregate mixed online, offline, supported, and repair-required machines.
- Require an identical stable version before enabling broadcast.
- Preserve successful rows when another RPC rejects.
- Render installation success separately from authentication missing.
- Expire a preview and require rescan before apply.

### User-visible verification

- Capture the fleet overview before and after the feature.
- Capture a mixed-state preview containing no-op, change, and repair-required rows.
- Capture completed, partial-failure, and dark-theme states.
- Include one independent before/after evidence group for each visible UI case in the PR.

### Real three-device acceptance

1. Confirm all three daemons are online.
2. Scan all three machines and compare observations with direct local commands.
3. If all machines are already aligned, verify the broadcast is a three-device idempotent no-op rather than intentionally downgrading a machine.
4. If a real upgrade is available, approve it once and verify each eligible machine independently.
5. Confirm missing authentication is reported without exposing a token.
6. Confirm a second scan matches the final UI state.

## 13. PoC acceptance criteria

- All online supported machines return a typed GitHub CLI observation.
- The user can see daemon, version, and authentication as separate states.
- No mutation occurs before the confirmation sheet is accepted.
- A broadcast never contains arbitrary shell input.
- All eligible machines either reach the same approved target version or show an explicit failure reason.
- Re-running alignment on compliant machines changes nothing.
- Unsupported and offline machines receive actionable repair guidance.
- No credential value appears in server-visible data, RPC results, UI, or logs.
- Existing session creation, machine list, and generic machine RPC behavior remain unchanged.

## 14. Expansion path

After this PoC is validated, expansion proceeds without changing the core adapter contract:

1. Persist environment profiles and durable fleet jobs on the server.
2. Queue pinned, expiring work for offline devices.
3. Add end-to-end encrypted credential distribution with explicit per-provider opt-in and device-bound-auth exceptions.
4. Add Ego Browser and other standardized component adapters.
5. Add Happy CLI/daemon self-update through an external supervisor with atomic rollback.
6. Add SSH topology checks, device onboarding, and guided rescue execution.
7. Add policy groups so a subset of devices can intentionally use a different environment profile.

Each new adapter must define its own detection, plan, mutation, verification, rollback limits, secret handling, and SSH fallback guidance before it is admitted to the registry.
