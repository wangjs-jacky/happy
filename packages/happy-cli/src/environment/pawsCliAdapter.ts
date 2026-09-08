import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
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
const PACKAGE_NAME = '@wangjs-jacky/paws';
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export type PawsCliAdapterDeps = {
  readonly runner: ProcessRunner;
  readonly resolveExecutable: typeof resolveExecutable;
  readonly resolveRealpath: (path: string) => Promise<string | null>;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
  readonly architecture: string;
  readonly now: () => number;
};

function isSuccessful(result: ProcessResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

function isValidSemver(version: string): boolean {
  const match = SEMVER_PATTERN.exec(version);
  if (match === null) return false;
  for (let index = 1; index <= 3; index += 1) {
    const identifier = match[index]!;
    if (identifier.length > 1 && identifier.startsWith('0')) return false;
  }
  return match[4]?.split('.').every((identifier) => (
    !/^\d+$/u.test(identifier) || identifier.length === 1 || !identifier.startsWith('0')
  )) ?? true;
}

function parseNpmVersion(stdout: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === 'string' && isValidSemver(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function parseNpmPrefix(stdout: string): string | null {
  const prefix = stdout.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  return isAbsolute(prefix) ? prefix : null;
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

export function compareVersions(left: string, right: string): number | null {
  if (!isValidSemver(left) || !isValidSemver(right)) return null;
  const leftMatch = SEMVER_PATTERN.exec(left);
  const rightMatch = SEMVER_PATTERN.exec(right);
  if (leftMatch === null || rightMatch === null) return null;
  for (let index = 1; index <= 3; index += 1) {
    const compared = compareNumericIdentifiers(leftMatch[index]!, rightMatch[index]!);
    if (compared !== 0) return compared;
  }
  return comparePrerelease(leftMatch[4], rightMatch[4]);
}

function fingerprint(desired: DesiredComponentState, observed: ComponentObservation): string {
  return createHash('sha256').update(JSON.stringify({
    componentId: desired.componentId,
    targetVersion: desired.targetVersion,
    installedVersion: observed.installedVersion,
    resolvedExecutable: observed.resolvedExecutable,
    npmAvailable: observed.source.available,
    npmLatestVersion: observed.source.latestVersion,
    npmOwnership: observed.source.ownership,
  }), 'utf8').digest('hex');
}

function planAction(desired: DesiredComponentState, observed: ComponentObservation): {
  action: ComponentPlan['action'];
  reasonCode?: EnvironmentReasonCode;
} {
  if (observed.support !== 'supported') {
    return { action: 'manual-repair', reasonCode: observed.reasonCode ?? 'unexpected-error' };
  }
  if (!observed.source.available || observed.source.latestVersion === null) {
    return { action: 'manual-repair', reasonCode: observed.reasonCode ?? 'unexpected-error' };
  }
  if (observed.source.ownership !== 'verified') {
    return { action: 'manual-repair', reasonCode: 'version-source-mismatch' };
  }
  if (observed.source.latestVersion !== desired.targetVersion) {
    return { action: 'manual-repair', reasonCode: 'version-source-mismatch' };
  }
  if (!observed.installed && observed.installedVersion === null && observed.resolvedExecutable === null) {
    return { action: 'install' };
  }
  if (observed.installedVersion === null) {
    return { action: 'manual-repair', reasonCode: 'unexpected-error' };
  }
  const comparison = compareVersions(observed.installedVersion, desired.targetVersion);
  if (comparison === null || comparison > 0) return { action: 'manual-repair', reasonCode: 'version-ahead' };
  return comparison === 0 ? { action: 'none' } : { action: 'upgrade' };
}

export function parsePawsCliVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/u, 1)[0] ?? '';
  const version = /^happy version: (\S+)$/u.exec(firstLine)?.[1];
  return version !== undefined && isValidSemver(version) ? version : null;
}

export function createPawsCliAdapter(
  deps: PawsCliAdapterDeps,
): EnvironmentComponentAdapter & Required<Pick<EnvironmentComponentAdapter, 'plan' | 'apply'>> {
  return {
    id: 'paws-cli',
    alignment: 'supported',

    async inspect(): Promise<ComponentObservation> {
      const inspectedAt = deps.now();
      const unsupported = (reasonCode: EnvironmentReasonCode): ComponentObservation => ({
        componentId: 'paws-cli', platform: deps.platform, architecture: deps.architecture,
        support: 'unsupported', installed: false, installedVersion: null, resolvedExecutable: null,
        source: { kind: 'npm-global', available: false, latestVersion: null, ownership: 'unverified' },
        capability: 'inspect-only', details: { kind: 'paws-cli' }, inspectedAt, reasonCode,
      });
      if (deps.platform !== 'darwin') return unsupported('unsupported-platform');
      if (deps.architecture !== 'arm64') return unsupported('unsupported-architecture');

      const [pawsPath, npmPath] = await Promise.all([
        deps.resolveExecutable('paws', deps.env.PATH, []),
        deps.resolveExecutable('npm', deps.env.PATH, []),
      ]);
      const inspectOptions = { timeoutMs: INSPECT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env };
      const pawsVersionResult = pawsPath === null ? null : await deps.runner.run(pawsPath, ['--version'], inspectOptions);
      const npmLatestResult = npmPath === null
        ? null
        : await deps.runner.run(npmPath, ['view', PACKAGE_NAME, 'version', '--json'], inspectOptions);
      const npmPrefixResult = npmPath === null
        ? null
        : await deps.runner.run(npmPath, ['prefix', '-g'], inspectOptions);
      const installedVersion = pawsVersionResult !== null && isSuccessful(pawsVersionResult)
        ? parsePawsCliVersion(pawsVersionResult.stdout)
        : null;
      const latestVersion = npmLatestResult !== null && isSuccessful(npmLatestResult)
        ? parseNpmVersion(npmLatestResult.stdout)
        : null;
      const npmPrefix = npmPrefixResult !== null && isSuccessful(npmPrefixResult)
        ? parseNpmPrefix(npmPrefixResult.stdout)
        : null;
      let ownership: 'verified' | 'unverified' = 'unverified';
      if (pawsPath !== null && npmPrefix !== null) {
        try {
          const expectedPackageBinPath = join(
            npmPrefix, 'lib', 'node_modules', PACKAGE_NAME, 'bin', 'happy.mjs',
          );
          const [resolvedPawsPath, resolvedPackageBinPath] = await Promise.all([
            deps.resolveRealpath(pawsPath),
            deps.resolveRealpath(expectedPackageBinPath),
          ]);
          if (resolvedPawsPath !== null && resolvedPawsPath === resolvedPackageBinPath) {
            ownership = 'verified';
          }
        } catch {
          ownership = 'unverified';
        }
      }
      const reasonCode = npmLatestResult?.timedOut === true || npmPrefixResult?.timedOut === true
        ? 'process-timeout' as const
        : pawsPath !== null && ownership !== 'verified'
          ? 'version-source-mismatch' as const
          : pawsPath !== null && installedVersion === null
            ? 'unexpected-error' as const
            : npmPath === null || latestVersion === null || npmPrefix === null
              ? 'unexpected-error' as const
              : undefined;
      return {
        componentId: 'paws-cli', platform: deps.platform, architecture: deps.architecture,
        support: 'supported', installed: pawsPath !== null, installedVersion, resolvedExecutable: pawsPath,
        source: { kind: 'npm-global', available: npmPath !== null, latestVersion, ownership },
        capability: ownership === 'verified' ? 'alignable' : 'inspect-only', details: { kind: 'paws-cli' }, inspectedAt,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },

    plan(desired, observed, now): ComponentPlan {
      const decision = planAction(desired, observed);
      return {
        componentId: 'paws-cli', action: decision.action, fromVersion: observed.installedVersion,
        targetVersion: desired.targetVersion, planFingerprint: fingerprint(desired, observed),
        expiresAt: now + PLAN_TTL_MS,
        ...(decision.reasonCode === undefined ? {} : { reasonCode: decision.reasonCode }),
      };
    },

    async apply(approvedPlan): Promise<ProcessResult> {
      if (approvedPlan.action === 'manual-repair') throw new Error('manual-repair plans cannot be applied');
      if (approvedPlan.action === 'none') return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      if (approvedPlan.targetVersion === null) throw new Error('approved Paws plan has no target version');
      const npmPath = await deps.resolveExecutable('npm', deps.env.PATH, []);
      if (npmPath === null) throw new Error('npm executable is unavailable');
      return deps.runner.run(npmPath, ['install', '--global', `${PACKAGE_NAME}@${approvedPlan.targetVersion}`], {
        timeoutMs: APPLY_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
      });
    },
  };
}
