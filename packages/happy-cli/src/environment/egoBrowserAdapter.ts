/**
 * Safely inspect the local Ego Lite application and its CLI without starting a
 * browser, task space, or onboarding flow.
 */
import type { ComponentObservation, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { resolveExecutable, type ProcessResult, type ProcessRunner } from './processRunner';

const INSPECT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_VERSION_LENGTH = 128;
const APP_PLIST_SUFFIX = 'Ego Lite.app/Contents/Info.plist';

export type EgoBrowserAdapterDeps = {
  readonly runner: ProcessRunner;
  readonly resolveExecutable: typeof resolveExecutable;
  readonly readPlistValue: (path: string, key: 'CFBundleShortVersionString') => Promise<string | null>;
  readonly env: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly platform: string;
  readonly architecture: string;
  readonly now: () => number;
};

export type EgoBrowserVersion = {
  readonly cliVersion: string;
  readonly chromiumVersion: string;
  readonly nodeVersion: string;
};

type MutableEgoBrowserVersion = {
  cliVersion?: string;
  chromiumVersion?: string;
  nodeVersion?: string;
};

const VERSION_PATTERN = /^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/u;

function successful(result: ProcessResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

/** Parse the complete, documented `ego-browser --version` output only. */
export function parseEgoBrowserVersion(stdout: string): EgoBrowserVersion | null {
  const values: MutableEgoBrowserVersion = {};
  const lines = stdout.trim().split(/\r?\n/u);
  if (lines.length !== 3) return null;

  for (const line of lines) {
    const match = /^\s*(ego-browser|chromium)\s+(\S+)\s*$/u.exec(line)
      ?? /^\s*(node)\s+v(\S+)\s*$/u.exec(line);
    if (match === null || match[2]!.length > MAX_VERSION_LENGTH || !VERSION_PATTERN.test(match[2]!)) return null;
    const version = match[2]!;
    switch (match[1]) {
      case 'ego-browser':
        if (values.cliVersion !== undefined) return null;
        values.cliVersion = version;
        break;
      case 'chromium':
        if (values.chromiumVersion !== undefined) return null;
        values.chromiumVersion = version;
        break;
      case 'node':
        if (values.nodeVersion !== undefined) return null;
        values.nodeVersion = version;
        break;
    }
  }

  return values.cliVersion !== undefined && values.chromiumVersion !== undefined && values.nodeVersion !== undefined
    ? values as EgoBrowserVersion
    : null;
}

function validAppVersion(value: string | null): string | null {
  return value !== null && value.length <= MAX_VERSION_LENGTH && VERSION_PATTERN.test(value) ? value : null;
}

async function readAppVersion(deps: EgoBrowserAdapterDeps): Promise<string | null> {
  const plistPaths = [
    `/Applications/${APP_PLIST_SUFFIX}`,
    `${deps.homeDirectory}/Applications/${APP_PLIST_SUFFIX}`,
  ];
  for (const path of plistPaths) {
    const version = validAppVersion(await deps.readPlistValue(path, 'CFBundleShortVersionString'));
    if (version !== null) return version;
  }
  return null;
}

export function createEgoBrowserAdapter(deps: EgoBrowserAdapterDeps): EnvironmentComponentAdapter {
  return {
    id: 'ego-browser',
    alignment: 'inspect-only',

    async inspect(): Promise<ComponentObservation> {
      const inspectedAt = deps.now();
      const [pathExecutable, appVersion] = await Promise.all([
        deps.resolveExecutable('ego-browser', deps.env.PATH, []),
        deps.platform === 'darwin' ? readAppVersion(deps) : null,
      ]);
      const pathReady = pathExecutable !== null;
      const egoPath = pathExecutable ?? await deps.resolveExecutable(
        'ego-browser', undefined, [`${deps.homeDirectory}/.local/bin/ego-browser`],
      );
      const versionResult = egoPath === null
        ? null
        : await deps.runner.run(egoPath, ['--version'], {
          timeoutMs: INSPECT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
        });
      const parsedVersion = versionResult !== null && successful(versionResult)
        ? parseEgoBrowserVersion(versionResult.stdout)
        : null;
      const versionsMatch = appVersion !== null && parsedVersion !== null && appVersion === parsedVersion.cliVersion;
      const paired = pathReady && versionsMatch;
      const reasonCode: EnvironmentReasonCode | undefined = deps.platform !== 'darwin'
        ? 'unsupported-platform'
        : versionResult?.timedOut === true
          ? 'process-timeout'
          : appVersion !== null && parsedVersion !== null && !versionsMatch
            ? 'version-source-mismatch'
            : !pathReady || egoPath === null || appVersion === null || parsedVersion === null
              ? 'unexpected-error'
              : undefined;

      return {
        componentId: 'ego-browser', platform: deps.platform, architecture: deps.architecture,
        support: deps.platform === 'darwin' ? 'supported' : 'unsupported', installed: egoPath !== null, installedVersion: parsedVersion?.cliVersion ?? null,
        resolvedExecutable: egoPath,
        source: {
          kind: 'app-managed', available: appVersion !== null, latestVersion: appVersion, ownership: 'not-applicable',
        },
        capability: 'inspect-only',
        details: {
          kind: 'ego-browser', appVersion, chromiumVersion: parsedVersion?.chromiumVersion ?? null,
          nodeVersion: parsedVersion?.nodeVersion ?? null, pathReady, paired,
        },
        inspectedAt,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },
  };
}
