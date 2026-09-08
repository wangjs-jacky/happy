/** Inspect cloudflared versions and the conventional login-certificate path. */
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import type { ComponentObservation, ComponentPlan, DesiredComponentState, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { parseHomebrewStableVersion } from './githubCliAdapter';
import { compareVersions } from './pawsCliAdapter';
import { resolveExecutable, type ProcessResult, type ProcessRunner } from './processRunner';

const INSPECT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const APPLY_TIMEOUT_MS = 8 * 60_000;
const PLAN_TTL_MS = 10 * 60_000;

export type CloudflaredAdapterDeps = {
  readonly runner: ProcessRunner;
  readonly resolveExecutable: typeof resolveExecutable;
  readonly resolveRealpath: (path: string) => Promise<string | null>;
  readonly pathExists: (path: string) => Promise<boolean>;
  readonly env: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly platform: string;
  readonly architecture: string;
  readonly now: () => number;
};

function successful(result: ProcessResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

function parseAbsolutePath(stdout: string): string | null {
  const path = stdout.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  return isAbsolute(path) ? path : null;
}

export function parseCloudflaredVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/u, 1)[0] ?? '';
  const version = /^cloudflared version (\S+)(?: \(.+\))?$/u.exec(firstLine)?.[1];
  return version !== undefined && version.length <= 128 && VERSION_PATTERN.test(version) ? version : null;
}

function fingerprint(desired: DesiredComponentState, observed: ComponentObservation): string {
  return createHash('sha256').update(JSON.stringify({
    componentId: desired.componentId,
    targetVersion: desired.targetVersion,
    installedVersion: observed.installedVersion,
    resolvedExecutable: observed.resolvedExecutable,
    source: observed.source,
    details: observed.details,
  }), 'utf8').digest('hex');
}

export function createCloudflaredAdapter(
  deps: CloudflaredAdapterDeps,
): EnvironmentComponentAdapter & Required<Pick<EnvironmentComponentAdapter, 'plan' | 'apply'>> {
  return {
    id: 'cloudflared',
    alignment: 'supported',

    async inspect(): Promise<ComponentObservation> {
      const inspectedAt = deps.now();
      const brewPath = await deps.resolveExecutable('brew', deps.env.PATH, BREW_CANDIDATES);
      const cloudflaredCandidates = brewPath === null ? [] : [join(dirname(brewPath), 'cloudflared')];
      const [cloudflaredPath, tunnelCertificatePresent] = await Promise.all([
        deps.resolveExecutable('cloudflared', deps.env.PATH, cloudflaredCandidates),
        deps.pathExists(join(deps.homeDirectory, '.cloudflared', 'cert.pem')).catch(() => false),
      ]);
      const inspectOptions = {
        timeoutMs: INSPECT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
      };
      const [versionResult, brewInfoResult, formulaPrefixResult] = await Promise.all([
        cloudflaredPath === null ? null : deps.runner.run(cloudflaredPath, ['--version'], inspectOptions),
        brewPath === null
          ? null
          : deps.runner.run(brewPath, ['info', '--json=v2', 'cloudflared'], inspectOptions),
        brewPath === null || cloudflaredPath === null
          ? null
          : deps.runner.run(brewPath, ['--prefix', 'cloudflared'], inspectOptions),
      ]);
      const installedVersion = versionResult !== null && successful(versionResult)
        ? parseCloudflaredVersion(versionResult.stdout)
        : null;
      const parsedLatestVersion = brewInfoResult !== null && successful(brewInfoResult)
        ? parseHomebrewStableVersion(brewInfoResult.stdout)
        : null;
      const latestVersion = parsedLatestVersion !== null
        && parsedLatestVersion.length <= 128
        && VERSION_PATTERN.test(parsedLatestVersion)
        ? parsedLatestVersion
        : null;
      const formulaPrefix = formulaPrefixResult !== null && successful(formulaPrefixResult)
        ? parseAbsolutePath(formulaPrefixResult.stdout) : null;
      let ownership: 'verified' | 'unverified' | 'not-applicable' = cloudflaredPath === null ? 'not-applicable' : 'unverified';
      if (cloudflaredPath !== null && formulaPrefix !== null) {
        const [resolvedCloudflared, resolvedExpected] = await Promise.all([
          deps.resolveRealpath(cloudflaredPath), deps.resolveRealpath(join(formulaPrefix, 'bin', 'cloudflared')),
        ]);
        if (resolvedCloudflared !== null && resolvedCloudflared === resolvedExpected) ownership = 'verified';
      }
      const reasonCode: EnvironmentReasonCode | undefined = [versionResult, brewInfoResult, formulaPrefixResult]
        .some((result) => result?.timedOut === true)
        ? 'process-timeout'
        : brewPath === null
          ? 'homebrew-missing'
        : latestVersion === null
            ? 'formula-unavailable'
            : cloudflaredPath !== null && ownership !== 'verified'
              ? 'version-source-mismatch'
            : cloudflaredPath !== null && installedVersion === null
              ? 'unexpected-error'
              : !tunnelCertificatePresent
                ? 'authentication-missing'
              : undefined;

      return {
        componentId: 'cloudflared', platform: deps.platform, architecture: deps.architecture,
        support: 'supported', installed: cloudflaredPath !== null, installedVersion,
        resolvedExecutable: cloudflaredPath,
        source: {
          kind: 'homebrew', available: brewPath !== null, latestVersion, ownership,
        },
        capability: brewPath !== null && latestVersion !== null
          && (cloudflaredPath === null || ownership === 'verified') ? 'alignable' : 'inspect-only',
        details: { kind: 'cloudflared', tunnelCertificatePresent },
        inspectedAt,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },

    plan(desired, observed, now): ComponentPlan {
      let action: ComponentPlan['action'] = 'manual-repair';
      let reasonCode: EnvironmentReasonCode | undefined = observed.reasonCode;
      if (observed.capability === 'alignable' && observed.source.available
        && observed.source.latestVersion === desired.targetVersion) {
        if (!observed.installed) {
          action = 'install';
          reasonCode = undefined;
        } else if (observed.source.ownership === 'verified' && observed.installedVersion !== null) {
          const comparison = compareVersions(observed.installedVersion, desired.targetVersion);
          if (comparison === null || comparison > 0) {
            action = 'manual-repair';
            reasonCode = comparison === null ? 'unexpected-error' : 'version-ahead';
          } else if (comparison < 0) {
            action = 'upgrade';
            reasonCode = undefined;
          } else if (observed.details.kind === 'cloudflared' && !observed.details.tunnelCertificatePresent) {
            action = 'authenticate';
            reasonCode = undefined;
          } else {
            action = 'none';
            reasonCode = undefined;
          }
        }
      }
      return {
        componentId: 'cloudflared', action, fromVersion: observed.installedVersion,
        targetVersion: desired.targetVersion, planFingerprint: fingerprint(desired, observed),
        expiresAt: now + PLAN_TTL_MS,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },

    async apply(approvedPlan): Promise<ProcessResult> {
      if (approvedPlan.action === 'manual-repair') throw new Error('manual-repair plans cannot be applied');
      if (approvedPlan.action === 'none') return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      const brewPath = await deps.resolveExecutable('brew', deps.env.PATH, BREW_CANDIDATES);
      if (approvedPlan.action === 'authenticate') {
        const candidates = brewPath === null ? [] : [join(dirname(brewPath), 'cloudflared')];
        const cloudflaredPath = await deps.resolveExecutable('cloudflared', deps.env.PATH, candidates);
        if (cloudflaredPath === null) throw new Error('cloudflared executable is unavailable');
        return deps.runner.run(cloudflaredPath, ['tunnel', 'login'], {
          timeoutMs: APPLY_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
        });
      }
      if (brewPath === null) throw new Error('Homebrew executable is unavailable');
      const verb = approvedPlan.action === 'install' ? 'install' : 'upgrade';
      return deps.runner.run(brewPath, [verb, 'cloudflared'], {
        timeoutMs: APPLY_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
      });
    },
  };
}
