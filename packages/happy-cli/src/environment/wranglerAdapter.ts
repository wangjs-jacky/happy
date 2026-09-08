/**
 * Inspect Wrangler installation and authentication while reducing command
 * output to the bounded, non-secret fields allowed by the environment wire.
 */
import type { ComponentObservation, EnvironmentReasonCode } from '@slopus/happy-wire';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { resolveExecutable, type ProcessResult, type ProcessRunner } from './processRunner';

const INSPECT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_ACCOUNT_LABELS = 8;
const MAX_ACCOUNT_LABEL_LENGTH = 128;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export type WranglerAdapterDeps = {
  readonly runner: ProcessRunner;
  readonly resolveExecutable: typeof resolveExecutable;
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

export function createWranglerAdapter(deps: WranglerAdapterDeps): EnvironmentComponentAdapter {
  return {
    id: 'cloudflare-wrangler',
    alignment: 'inspect-only',

    async inspect(): Promise<ComponentObservation> {
      const inspectedAt = deps.now();
      const [wranglerPath, npmPath] = await Promise.all([
        deps.resolveExecutable('wrangler', deps.env.PATH, []),
        deps.resolveExecutable('npm', deps.env.PATH, []),
      ]);
      const inspectOptions = {
        timeoutMs: INSPECT_TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES, env: deps.env,
      };
      const [versionResult, latestResult, whoamiResult] = await Promise.all([
        wranglerPath === null ? null : deps.runner.run(wranglerPath, ['--version'], inspectOptions),
        npmPath === null ? null : deps.runner.run(npmPath, ['view', 'wrangler', 'version', '--json'], inspectOptions),
        wranglerPath === null ? null : deps.runner.run(wranglerPath, ['whoami'], inspectOptions),
      ]);
      const installedVersion = versionResult !== null && successful(versionResult)
        ? parseWranglerVersion(versionResult.stdout)
        : null;
      const latestVersion = latestResult !== null && successful(latestResult)
        ? parseNpmVersion(latestResult.stdout)
        : null;
      const authentication: WranglerWhoami = whoamiResult === null || whoamiResult.timedOut
        ? { status: 'unknown' }
        : whoamiResult.exitCode !== 0
          ? { status: parseWranglerWhoami(`${whoamiResult.stdout}\n${whoamiResult.stderr}`).status === 'missing' ? 'missing' : 'unknown' }
          : parseWranglerWhoami(whoamiResult.stdout);
      const reasonCode: EnvironmentReasonCode | undefined = [versionResult, latestResult, whoamiResult]
        .some((result) => result?.timedOut === true)
        ? 'process-timeout'
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
          kind: 'npm-global', available: npmPath !== null, latestVersion, ownership: 'not-applicable',
        },
        capability: 'inspect-only',
        authentication: {
          provider: 'cloudflare', status: authentication.status,
          ...(authentication.accountLabels === undefined ? {} : { accountLabels: [...authentication.accountLabels] }),
        },
        details: { kind: 'cloudflare-wrangler' }, inspectedAt,
        ...(reasonCode === undefined ? {} : { reasonCode }),
      };
    },
  };
}
