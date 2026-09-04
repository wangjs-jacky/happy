import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type {
  ComponentObservation,
  ComponentPlan,
  DesiredComponentState,
  EnvironmentReasonCode,
} from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { resolveExecutable, type ProcessResult, type ProcessRunner } from './processRunner';

const INSPECT_TIMEOUT_MS = 15_000;
const APPLY_TIMEOUT_MS = 8 * 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const PLAN_TTL_MS = 10 * 60_000;
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
const AUTH_TOKEN_VARIABLES = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
] as const;

export type GitHubCliAdapterDeps = {
  readonly runner: ProcessRunner;
  readonly resolveExecutable: typeof resolveExecutable;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
  readonly architecture: string;
  readonly now: () => number;
};

function isSuccessful(result: ProcessResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

function sanitizedAuthEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...environment };
  for (const variable of AUTH_TOKEN_VARIABLES) delete sanitized[variable];
  return sanitized;
}

function compareNumericIdentifiers(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+/u, '') || '0';
  const normalizedRight = right.replace(/^0+/u, '') || '0';
  if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

function comparePrerelease(left: string | undefined, right: string | undefined): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;

  const leftIdentifiers = left.split('.');
  const rightIdentifiers = right.split('.');
  const length = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftIdentifiers[index];
    const rightIdentifier = rightIdentifiers[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = /^\d+$/u.test(leftIdentifier);
    const rightNumeric = /^\d+$/u.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}

function compareVersions(left: string, right: string): number | null {
  const pattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
  const leftMatch = pattern.exec(left);
  const rightMatch = pattern.exec(right);
  if (leftMatch === null || rightMatch === null) return null;

  for (let index = 1; index <= 3; index += 1) {
    const compared = compareNumericIdentifiers(leftMatch[index]!, rightMatch[index]!);
    if (compared !== 0) return compared;
  }
  return comparePrerelease(leftMatch[4], rightMatch[4]);
}

function fingerprint(desired: DesiredComponentState, observed: ComponentObservation): string {
  const canonicalJson = JSON.stringify({
    componentId: desired.componentId,
    targetVersion: desired.targetVersion,
    installedVersion: observed.installedVersion,
    resolvedExecutable: observed.resolvedExecutable,
    homebrewAvailable: observed.packageManager.available,
    homebrewStableVersion: observed.packageManager.stableVersion,
  });
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

function manualRepairReason(observed: ComponentObservation): EnvironmentReasonCode | undefined {
  if (observed.support !== 'supported') return observed.reasonCode ?? 'unexpected-error';
  if (!observed.packageManager.available) return 'homebrew-missing';
  if (observed.packageManager.stableVersion === null) return 'formula-unavailable';
  if (observed.reasonCode === 'version-source-mismatch') return 'version-source-mismatch';
  if (observed.installed && observed.installedVersion === null) return 'unexpected-error';
  return undefined;
}

function planAction(desired: DesiredComponentState, observed: ComponentObservation): {
  action: ComponentPlan['action'];
  reasonCode?: EnvironmentReasonCode;
} {
  const unavailableReason = manualRepairReason(observed);
  if (unavailableReason !== undefined) return { action: 'manual-repair', reasonCode: unavailableReason };
  if (observed.packageManager.stableVersion !== desired.targetVersion) {
    return { action: 'manual-repair', reasonCode: 'version-source-mismatch' };
  }
  const executableAbsent = !observed.installed
    && observed.installedVersion === null
    && observed.resolvedExecutable === null;
  if (executableAbsent) return { action: 'install' };
  if (observed.installedVersion === null) return { action: 'manual-repair', reasonCode: 'unexpected-error' };

  const versionComparison = compareVersions(observed.installedVersion, desired.targetVersion);
  if (versionComparison === null || versionComparison > 0) {
    return { action: 'manual-repair', reasonCode: 'version-ahead' };
  }
  return versionComparison === 0 ? { action: 'none' } : { action: 'upgrade' };
}

export function parseGitHubCliVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/u, 1)[0] ?? '';
  return /^gh version (\d+\.\d+\.\d+)(?:\s|$)/u.exec(firstLine)?.[1] ?? null;
}

export function parseHomebrewStableVersion(stdout: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null || !('formulae' in parsed)) return null;
    const formulae = parsed.formulae;
    if (!Array.isArray(formulae) || formulae.length === 0) return null;
    const firstFormula = formulae[0];
    if (typeof firstFormula !== 'object' || firstFormula === null || !('versions' in firstFormula)) return null;
    const versions = firstFormula.versions;
    if (typeof versions !== 'object' || versions === null || !('stable' in versions)) return null;
    return typeof versions.stable === 'string' && versions.stable.length > 0 ? versions.stable : null;
  } catch {
    return null;
  }
}

export function createGitHubCliAdapter(deps: GitHubCliAdapterDeps): EnvironmentComponentAdapter {
  return {
    id: 'github-cli',

    async inspect(): Promise<ComponentObservation> {
      const inspectedAt = deps.now();
      const unsupported = (reasonCode: EnvironmentReasonCode): ComponentObservation => ({
        componentId: 'github-cli',
        platform: deps.platform,
        architecture: deps.architecture,
        support: 'unsupported',
        installed: false,
        installedVersion: null,
        resolvedExecutable: null,
        packageManager: { kind: 'homebrew', available: false, stableVersion: null },
        authentication: { provider: 'github.com', status: 'unknown' },
        inspectedAt,
        reasonCode,
      });

      if (deps.platform !== 'darwin') return unsupported('unsupported-platform');
      if (deps.architecture !== 'arm64') return unsupported('unsupported-architecture');

      const brewPath = await deps.resolveExecutable('brew', deps.env.PATH, BREW_CANDIDATES);
      const homebrewGhPath = brewPath === null ? null : join(dirname(brewPath), 'gh');
      const ghCandidates = homebrewGhPath === null ? [] : [homebrewGhPath];
      const ghPath = await deps.resolveExecutable('gh', deps.env.PATH, ghCandidates);
      const inspectOptions = { timeoutMs: INSPECT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env };

      const ghVersionResult = ghPath === null
        ? null
        : await deps.runner.run(ghPath, ['--version'], inspectOptions);
      const brewInfoResult = brewPath === null
        ? null
        : await deps.runner.run(brewPath, ['info', '--json=v2', 'gh'], inspectOptions);
      const authResult = ghPath === null
        ? null
        : await deps.runner.run(ghPath, ['auth', 'status', '--hostname', 'github.com'], {
          ...inspectOptions,
          env: sanitizedAuthEnvironment(deps.env),
        });

      const installedVersion = ghVersionResult !== null && isSuccessful(ghVersionResult)
        ? parseGitHubCliVersion(ghVersionResult.stdout)
        : null;
      const stableVersion = brewInfoResult !== null && isSuccessful(brewInfoResult)
        ? parseHomebrewStableVersion(brewInfoResult.stdout)
        : null;
      const authenticationStatus = authResult === null || authResult.timedOut
        ? 'unknown'
        : authResult.exitCode === 0 ? 'authenticated' : 'missing';

      return {
        componentId: 'github-cli',
        platform: deps.platform,
        architecture: deps.architecture,
        support: 'supported',
        installed: ghPath !== null,
        installedVersion,
        resolvedExecutable: ghPath,
        packageManager: { kind: 'homebrew', available: brewPath !== null, stableVersion },
        authentication: { provider: 'github.com', status: authenticationStatus },
        inspectedAt,
        ...(brewPath === null ? { reasonCode: 'homebrew-missing' as const }
          : stableVersion === null ? { reasonCode: 'formula-unavailable' as const }
            : ghPath !== null && ghPath !== homebrewGhPath ? { reasonCode: 'version-source-mismatch' as const } : {}),
      };
    },

    plan(desired, observed, now): ComponentPlan {
      const decision = planAction(desired, observed);
      return {
        componentId: 'github-cli',
        action: decision.action,
        fromVersion: observed.installedVersion,
        targetVersion: desired.targetVersion,
        planFingerprint: fingerprint(desired, observed),
        expiresAt: now + PLAN_TTL_MS,
        ...(decision.reasonCode === undefined ? {} : { reasonCode: decision.reasonCode }),
      };
    },

    async apply(approvedPlan): Promise<ProcessResult> {
      if (approvedPlan.action === 'manual-repair') {
        throw new Error('manual-repair plans cannot be applied');
      }
      if (approvedPlan.action === 'none') {
        return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      }

      const brewPath = await deps.resolveExecutable('brew', deps.env.PATH, BREW_CANDIDATES);
      if (brewPath === null) throw new Error('Homebrew executable is unavailable');
      const args = approvedPlan.action === 'install' ? ['install', 'gh'] : ['upgrade', 'gh'];
      return deps.runner.run(brewPath, args, {
        timeoutMs: APPLY_TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        env: { ...deps.env, HOMEBREW_NO_AUTO_UPDATE: '1' },
      });
    },
  };
}
