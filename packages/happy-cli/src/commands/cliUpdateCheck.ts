import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import chalk from 'chalk';
import { request } from 'undici';

import { configuration } from '@/configuration';
import packageJson from '../../package.json';

const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 1200;

type CliUpdateCache = {
  checkedAt?: number;
  latestVersion?: string;
};

type CliUpdateRuntime = {
  args?: string[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  stdin?: Pick<NodeJS.ReadStream, 'isTTY'>;
  stdout?: Pick<NodeJS.WriteStream, 'isTTY'>;
  now?: () => number;
  log?: (message: string) => void;
  cacheFile?: string;
  currentVersion?: string;
  packageName?: string;
  checkIntervalMs?: number;
  fetchLatestVersion?: (packageName: string) => Promise<string>;
};

export type CliUpdateCheckResult = 'skipped' | 'current' | 'new-version' | 'failed';

function parseVersion(version: string): [number, number, number] | null {
  const core = version.trim().replace(/^v/, '').split(/[+-]/, 1)[0];
  const parts = core.split('.');
  if (parts.length !== 3) return null;

  const parsed = parts.map((part) => Number(part));
  if (parsed.some((part) => !Number.isInteger(part) || part < 0)) return null;
  return [parsed[0], parsed[1], parsed[2]];
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < leftParts.length; index++) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function hasStartedByDaemon(args: string[]): boolean {
  return args.some((arg, index) => (
    arg === '--started-by=daemon'
    || (arg === '--started-by' && args[index + 1] === 'daemon')
  ));
}

export function shouldSkipCliUpdateCheck(runtime: Required<Pick<CliUpdateRuntime, 'args' | 'env' | 'stdin' | 'stdout'>>): boolean {
  if (runtime.env.HAPPY_SKIP_UPDATE_CHECK === '1') return true;
  if (runtime.env.CI === 'true') return true;
  if (runtime.stdin.isTTY !== true || runtime.stdout.isTTY !== true) return true;

  const args = runtime.args;
  if (args.includes('--json')) return true;
  if (args.includes('--version') || args.includes('-v')) return true;
  if (args.includes('--help') || args.includes('-h')) return true;
  if (args[0] === 'daemon') return true;
  if (hasStartedByDaemon(args)) return true;

  return false;
}

async function readCache(cacheFile: string): Promise<CliUpdateCache | null> {
  try {
    const parsed = JSON.parse(await readFile(cacheFile, 'utf8'));
    return {
      checkedAt: typeof parsed.checkedAt === 'number' ? parsed.checkedAt : undefined,
      latestVersion: typeof parsed.latestVersion === 'string' ? parsed.latestVersion : undefined,
    };
  } catch {
    return null;
  }
}

async function writeCache(cacheFile: string, cache: CliUpdateCache): Promise<void> {
  await mkdir(dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(cache, null, 2), 'utf8');
}

export async function fetchLatestNpmVersion(packageName: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const encodedPackageName = encodeURIComponent(packageName);

  try {
    const response = await request(`https://registry.npmjs.org/${encodedPackageName}/latest`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`npm registry returned ${response.statusCode}`);
    }

    const body = await response.body.text();
    const parsed = JSON.parse(body);
    if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
      throw new Error('npm registry response did not include a version');
    }
    return parsed.version;
  } finally {
    clearTimeout(timeout);
  }
}

function printUpdateNotice(log: (message: string) => void, packageName: string, currentVersion: string, latestVersion: string): void {
  log('');
  log(chalk.yellow(`Paws CLI ${latestVersion} is available. You are running ${currentVersion}.`));
  log(`Update with: ${chalk.cyan(`npm install -g ${packageName}@latest`)}`);
  log('');
}

export async function promptCliUpdateIfNeeded(runtime: CliUpdateRuntime = {}): Promise<CliUpdateCheckResult> {
  const args = runtime.args ?? process.argv.slice(2);
  const env = runtime.env ?? process.env;
  const stdin = runtime.stdin ?? process.stdin;
  const stdout = runtime.stdout ?? process.stdout;

  if (shouldSkipCliUpdateCheck({ args, env, stdin, stdout })) {
    return 'skipped';
  }

  const currentVersion = runtime.currentVersion ?? packageJson.version;
  const packageName = runtime.packageName ?? packageJson.name;
  const cacheFile = runtime.cacheFile ?? join(configuration.happyHomeDir, 'cli-update-check.json');
  const checkIntervalMs = runtime.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const now = runtime.now ?? Date.now;
  const log = runtime.log ?? console.log;
  const fetchLatestVersion = runtime.fetchLatestVersion ?? fetchLatestNpmVersion;

  const cache = await readCache(cacheFile);
  const cachedLatestVersion = cache?.latestVersion;
  const cachedUpdateAvailable = cachedLatestVersion
    ? compareVersions(cachedLatestVersion, currentVersion) > 0
    : false;

  if (cache?.checkedAt && now() - cache.checkedAt < checkIntervalMs) {
    if (cachedLatestVersion && cachedUpdateAvailable) {
      printUpdateNotice(log, packageName, currentVersion, cachedLatestVersion);
      return 'new-version';
    }
    return 'current';
  }

  try {
    const latestVersion = await fetchLatestVersion(packageName);
    await writeCache(cacheFile, {
      checkedAt: now(),
      latestVersion,
    });

    if (compareVersions(latestVersion, currentVersion) > 0) {
      printUpdateNotice(log, packageName, currentVersion, latestVersion);
      return 'new-version';
    }

    return 'current';
  } catch {
    if (cachedLatestVersion && cachedUpdateAvailable) {
      printUpdateNotice(log, packageName, currentVersion, cachedLatestVersion);
      return 'new-version';
    }
    return 'failed';
  }
}
