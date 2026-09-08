/**
 * Safely inspect the local Ego Lite application and its CLI without starting a
 * browser, task space, or onboarding flow.
 */
import { createHash } from 'node:crypto';
import type { ComponentObservation, ComponentPlan, DesiredComponentState, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { resolveExecutable, type ProcessResult, type ProcessRunner } from './processRunner';

const INSPECT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_VERSION_LENGTH = 128;
const APPLY_TIMEOUT_MS = 8 * 60_000;
const PLAN_TTL_MS = 10 * 60_000;
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

export function createEgoBrowserAdapter(
  deps: EgoBrowserAdapterDeps,
): EnvironmentComponentAdapter & Required<Pick<EnvironmentComponentAdapter, 'plan' | 'apply'>> {
  return {
    id: 'ego-browser',
    alignment: 'supported',

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
        ? parseEgoBrowserVersion(`${versionResult.stdout}\n${versionResult.stderr}`.trim())
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
        capability: deps.platform === 'darwin' && egoPath !== null && appVersion !== null && parsedVersion !== null
          ? 'alignable' : 'inspect-only',
        details: {
          kind: 'ego-browser', appVersion, chromiumVersion: parsedVersion?.chromiumVersion ?? null,
          nodeVersion: parsedVersion?.nodeVersion ?? null, pathReady, paired,
        },
        inspectedAt,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },

    plan(desired, observed, now): ComponentPlan {
      const details = observed.details.kind === 'ego-browser' ? observed.details : null;
      let action: ComponentPlan['action'] = 'manual-repair';
      let reasonCode: EnvironmentReasonCode | undefined = observed.reasonCode;
      if (observed.capability === 'alignable' && details !== null && details.appVersion === desired.targetVersion) {
        if (details.pathReady && !details.paired) {
          action = 'upgrade';
          reasonCode = undefined;
        } else if (details.pathReady) {
          action = 'none';
          reasonCode = undefined;
        }
      }
      return {
        componentId: 'ego-browser', action, fromVersion: observed.installedVersion,
        targetVersion: desired.targetVersion, planFingerprint: fingerprint(desired, observed),
        expiresAt: now + PLAN_TTL_MS,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },

    async apply(approvedPlan): Promise<ProcessResult> {
      if (approvedPlan.action === 'manual-repair') throw new Error('manual-repair plans cannot be applied');
      if (approvedPlan.action === 'none') return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      const executable = await deps.resolveExecutable(
        'ego-browser', deps.env.PATH, [`${deps.homeDirectory}/.local/bin/ego-browser`],
      );
      if (executable === null) throw new Error('ego-browser executable is unavailable');
      const args = approvedPlan.action === 'onboard' ? ['onboarding'] : ['upgrade'];
      return deps.runner.run(executable, args, {
        timeoutMs: APPLY_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
      });
    },
  };
}
