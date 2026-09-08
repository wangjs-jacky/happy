/** Inspect cloudflared versions and the conventional login-certificate path. */
import { dirname, join } from 'node:path';
import type { ComponentObservation, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { parseHomebrewStableVersion } from './githubCliAdapter';
import { resolveExecutable, type ProcessResult, type ProcessRunner } from './processRunner';

const INSPECT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const BREW_CANDIDATES = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export type CloudflaredAdapterDeps = {
  readonly runner: ProcessRunner;
  readonly resolveExecutable: typeof resolveExecutable;
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

export function parseCloudflaredVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/u, 1)[0] ?? '';
  const version = /^cloudflared version (\S+)(?: \(.+\))?$/u.exec(firstLine)?.[1];
  return version !== undefined && version.length <= 128 && VERSION_PATTERN.test(version) ? version : null;
}

export function createCloudflaredAdapter(deps: CloudflaredAdapterDeps): EnvironmentComponentAdapter {
  return {
    id: 'cloudflared',
    alignment: 'inspect-only',

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
      const [versionResult, brewInfoResult] = await Promise.all([
        cloudflaredPath === null ? null : deps.runner.run(cloudflaredPath, ['--version'], inspectOptions),
        brewPath === null
          ? null
          : deps.runner.run(brewPath, ['info', '--json=v2', 'cloudflared'], inspectOptions),
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
      const reasonCode: EnvironmentReasonCode | undefined = [versionResult, brewInfoResult]
        .some((result) => result?.timedOut === true)
        ? 'process-timeout'
        : brewPath === null
          ? 'homebrew-missing'
          : latestVersion === null
            ? 'formula-unavailable'
            : cloudflaredPath !== null && installedVersion === null
              ? 'unexpected-error'
              : undefined;

      return {
        componentId: 'cloudflared', platform: deps.platform, architecture: deps.architecture,
        support: 'supported', installed: cloudflaredPath !== null, installedVersion,
        resolvedExecutable: cloudflaredPath,
        source: {
          kind: 'homebrew', available: brewPath !== null, latestVersion, ownership: 'not-applicable',
        },
        capability: 'inspect-only', details: { kind: 'cloudflared', tunnelCertificatePresent },
        inspectedAt,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },
  };
}
