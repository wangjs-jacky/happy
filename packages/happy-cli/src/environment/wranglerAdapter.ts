/**
 * Inspect Wrangler installation and authentication while reducing command
 * output to the bounded, non-secret fields allowed by the environment wire.
 */
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import type { ComponentObservation, ComponentPlan, DesiredComponentState, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { compareVersions } from './pawsCliAdapter';
import { resolveExecutable, type ProcessResult, type ProcessRunner } from './processRunner';

const INSPECT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_ACCOUNT_LABELS = 8;
const MAX_ACCOUNT_LABEL_LENGTH = 128;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const APPLY_TIMEOUT_MS = 8 * 60_000;
const PLAN_TTL_MS = 10 * 60_000;
const PACKAGE_NAME = 'wrangler';

export type WranglerAdapterDeps = {
  readonly runner: ProcessRunner;
  readonly resolveExecutable: typeof resolveExecutable;
  readonly resolveRealpath: (path: string) => Promise<string | null>;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: string;
  readonly architecture: string;
  readonly now: () => number;
};

export type WranglerWhoami = {
  readonly status: 'authenticated' | 'missing' | 'unknown';
  readonly accountLabels?: readonly string[];
};

function successful(result: ProcessResult): boolean {
  return result.exitCode === 0 && !result.timedOut;
}

function validVersion(version: string): boolean {
  return version.length <= 128 && SEMVER_PATTERN.test(version);
}

function parseNpmVersion(stdout: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === 'string' && validVersion(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseNpmPrefix(stdout: string): string | null {
  const prefix = stdout.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  return isAbsolute(prefix) ? prefix : null;
}

function fingerprint(desired: DesiredComponentState, observed: ComponentObservation): string {
  return createHash('sha256').update(JSON.stringify({
    componentId: desired.componentId,
    targetVersion: desired.targetVersion,
    installedVersion: observed.installedVersion,
    resolvedExecutable: observed.resolvedExecutable,
    source: observed.source,
    authenticationStatus: observed.authentication?.status,
  }), 'utf8').digest('hex');
}

function safeAccountLabel(value: string): string | null {
  const label = value.trim();
  if (label.length === 0 || label.length > MAX_ACCOUNT_LABEL_LENGTH) return null;
  if (/[@\u0000-\u001f\u007f]/u.test(label) || /[a-f0-9]{32}/iu.test(label)) return null;
  if (/\b(?:bearer|permissions?|tokens?)\b/iu.test(label) || /(?:^|\s)(?:~?[\\/]|[A-Za-z]:\\)/u.test(label)) return null;
  if (/^(?=\S{24,}$)(?=.*[A-Za-z])(?=.*\d)\S+$/u.test(label)) return null;
  return label;
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('│') || !trimmed.endsWith('│')) return null;
  return trimmed.slice(1, -1).split('│').map((cell) => cell.trim());
}

export function parseWranglerVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  const version = /^(?:.*?\bwrangler\s+)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u.exec(firstLine)?.[1];
  return version !== undefined && validVersion(version) ? version : null;
}

/** Extract only Account Name table cells; all other `whoami` output is discarded. */
export function parseWranglerWhoami(stdout: string): WranglerWhoami {
  if (/not (?:logged in|authenticated)|please (?:login|log in)|wrangler login/iu.test(stdout)) {
    return { status: 'missing' };
  }

  const lines = stdout.split(/\r?\n/u);
  const headerIndex = lines.findIndex((line) => {
    const cells = tableCells(line);
    return cells !== null
      && cells.filter((cell) => cell === 'Account Name').length === 1
      && cells.filter((cell) => cell === 'Account ID').length === 1;
  });
  if (headerIndex < 0) return { status: 'unknown' };

  const headers = tableCells(lines[headerIndex]!)!;
  const accountNameColumn = headers.indexOf('Account Name');
  const accountLabels: string[] = [];
  const seen = new Set<string>();
  let candidateCount = 0;
  for (const line of lines.slice(headerIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('└')) break;
    if (trimmed.startsWith('├')) continue;
    const cells = tableCells(line);
    if (cells === null || cells.length !== headers.length) break;
    candidateCount += 1;
    const label = safeAccountLabel(cells[accountNameColumn] ?? '');
    if (label !== null && !seen.has(label)) {
      seen.add(label);
      accountLabels.push(label);
    }
    if (candidateCount === MAX_ACCOUNT_LABELS) break;
  }
  return accountLabels.length === 0
    ? { status: 'authenticated' }
    : { status: 'authenticated', accountLabels };
}

export function createWranglerAdapter(
  deps: WranglerAdapterDeps,
): EnvironmentComponentAdapter & Required<Pick<EnvironmentComponentAdapter, 'plan' | 'apply'>> {
  return {
    id: 'cloudflare-wrangler',
    alignment: 'supported',

    async inspect(): Promise<ComponentObservation> {
      const inspectedAt = deps.now();
      const [wranglerPath, npmPath] = await Promise.all([
        deps.resolveExecutable('wrangler', deps.env.PATH, []),
        deps.resolveExecutable('npm', deps.env.PATH, []),
      ]);
      const inspectOptions = {
        timeoutMs: INSPECT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
      };
      const [versionResult, latestResult, npmPrefixResult, whoamiResult] = await Promise.all([
        wranglerPath === null ? null : deps.runner.run(wranglerPath, ['--version'], inspectOptions),
        npmPath === null ? null : deps.runner.run(npmPath, ['view', 'wrangler', 'version', '--json'], inspectOptions),
        npmPath === null ? null : deps.runner.run(npmPath, ['prefix', '-g'], inspectOptions),
        wranglerPath === null ? null : deps.runner.run(wranglerPath, ['whoami'], inspectOptions),
      ]);
      const installedVersion = versionResult !== null && successful(versionResult)
        ? parseWranglerVersion(versionResult.stdout)
        : null;
      const latestVersion = latestResult !== null && successful(latestResult)
        ? parseNpmVersion(latestResult.stdout)
        : null;
      const npmPrefix = npmPrefixResult !== null && successful(npmPrefixResult)
        ? parseNpmPrefix(npmPrefixResult.stdout)
        : null;
      let ownership: 'verified' | 'unverified' | 'not-applicable' = wranglerPath === null ? 'not-applicable' : 'unverified';
      if (wranglerPath !== null && npmPrefix !== null) {
        const expected = join(npmPrefix, 'lib', 'node_modules', PACKAGE_NAME, 'bin', 'wrangler.js');
        const [resolvedWrangler, resolvedExpected] = await Promise.all([
          deps.resolveRealpath(wranglerPath), deps.resolveRealpath(expected),
        ]);
        if (resolvedWrangler !== null && resolvedWrangler === resolvedExpected) ownership = 'verified';
      }
      const authentication: WranglerWhoami = whoamiResult === null || whoamiResult.timedOut
        ? { status: 'unknown' }
        : whoamiResult.exitCode !== 0
          ? { status: parseWranglerWhoami(`${whoamiResult.stdout}\n${whoamiResult.stderr}`).status === 'missing' ? 'missing' : 'unknown' }
          : parseWranglerWhoami(whoamiResult.stdout);
      const reasonCode: EnvironmentReasonCode | undefined = [versionResult, latestResult, npmPrefixResult, whoamiResult]
        .some((result) => result?.timedOut === true)
        ? 'process-timeout'
        : wranglerPath !== null && ownership !== 'verified'
          ? 'version-source-mismatch'
        : authentication.status === 'missing'
          ? 'authentication-missing'
          : wranglerPath !== null && installedVersion === null
            ? 'unexpected-error'
            : npmPath === null || latestVersion === null || authentication.status === 'unknown'
              ? 'unexpected-error'
              : undefined;

      return {
        componentId: 'cloudflare-wrangler', platform: deps.platform, architecture: deps.architecture,
        support: 'supported', installed: wranglerPath !== null, installedVersion,
        resolvedExecutable: wranglerPath,
        source: {
          kind: 'npm-global', available: npmPath !== null && npmPrefix !== null, latestVersion, ownership,
        },
        capability: npmPath !== null && npmPrefix !== null && (wranglerPath === null || ownership === 'verified')
          ? 'alignable' : 'inspect-only',
        authentication: {
          provider: 'cloudflare', status: authentication.status,
          ...(authentication.accountLabels === undefined ? {} : { accountLabels: [...authentication.accountLabels] }),
        },
        details: { kind: 'cloudflare-wrangler' }, inspectedAt,
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
          } else if (observed.authentication?.status === 'missing') {
            action = 'authenticate';
            reasonCode = undefined;
          } else if (observed.authentication?.status === 'authenticated') {
            action = 'none';
            reasonCode = undefined;
          }
        }
      }
      return {
        componentId: 'cloudflare-wrangler', action, fromVersion: observed.installedVersion,
        targetVersion: desired.targetVersion, planFingerprint: fingerprint(desired, observed),
        expiresAt: now + PLAN_TTL_MS,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },

    async apply(approvedPlan): Promise<ProcessResult> {
      if (approvedPlan.action === 'manual-repair') throw new Error('manual-repair plans cannot be applied');
      if (approvedPlan.action === 'none') return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
      const executableName = approvedPlan.action === 'authenticate' ? 'wrangler' : 'npm';
      const executable = await deps.resolveExecutable(executableName, deps.env.PATH, []);
      if (executable === null) throw new Error(`${executableName} executable is unavailable`);
      const args = approvedPlan.action === 'authenticate'
        ? ['login', '--browser=true', '--use-keyring']
        : ['install', '--global', `${PACKAGE_NAME}@${approvedPlan.targetVersion}`];
      return deps.runner.run(executable, args, {
        timeoutMs: APPLY_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
      });
    },
  };
}
