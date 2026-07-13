import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { compareVersions, promptCliUpdateIfNeeded, shouldSkipCliUpdateCheck } from './cliUpdateCheck';

function interactiveRuntime() {
  return {
    args: [],
    env: {},
    stdin: { isTTY: true } as NodeJS.ReadStream,
    stdout: { isTTY: true } as NodeJS.WriteStream,
  };
}

describe('compareVersions', () => {
  it('compares semantic versions by major, minor, and patch', () => {
    expect(compareVersions('1.2.2', '1.2.1')).toBe(1);
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.2.1', '1.2.1')).toBe(0);
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1);
  });
});

describe('shouldSkipCliUpdateCheck', () => {
  it('skips machine-readable, daemon, and non-interactive invocations', () => {
    expect(shouldSkipCliUpdateCheck({
      ...interactiveRuntime(),
      args: ['attach', '--json'],
    })).toBe(true);
    expect(shouldSkipCliUpdateCheck({
      ...interactiveRuntime(),
      args: ['daemon', 'start-sync'],
    })).toBe(true);
    expect(shouldSkipCliUpdateCheck({
      ...interactiveRuntime(),
      args: ['codex', '--started-by', 'daemon'],
    })).toBe(true);
    expect(shouldSkipCliUpdateCheck({
      ...interactiveRuntime(),
      stdin: { isTTY: false } as NodeJS.ReadStream,
    })).toBe(true);
  });
});

describe('promptCliUpdateIfNeeded', () => {
  it('prints an install hint when npm has a newer version', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-cli-update-check-'));
    const logs: string[] = [];
    const fetchLatestVersion = vi.fn(async () => '1.2.2');

    const result = await promptCliUpdateIfNeeded({
      ...interactiveRuntime(),
      cacheFile: join(homeDir, 'cli-update-check.json'),
      currentVersion: '1.2.1',
      packageName: '@wangjs-jacky/paws',
      fetchLatestVersion,
      log: (message) => logs.push(message),
      now: () => 1000,
    });

    expect(result).toBe('new-version');
    expect(fetchLatestVersion).toHaveBeenCalledWith('@wangjs-jacky/paws');
    expect(logs.join('\n')).toContain('Paws CLI 1.2.2 is available');
    expect(logs.join('\n')).toContain('npm install -g @wangjs-jacky/paws@latest');
  });

  it('uses a fresh cache without calling npm again', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-cli-update-cache-'));
    const cacheFile = join(homeDir, 'cli-update-check.json');
    const logs: string[] = [];
    const fetchLatestVersion = vi.fn(async () => '1.2.3');
    await writeFile(cacheFile, JSON.stringify({
      checkedAt: 1000,
      latestVersion: '1.2.2',
    }), 'utf8');

    const result = await promptCliUpdateIfNeeded({
      ...interactiveRuntime(),
      cacheFile,
      currentVersion: '1.2.1',
      packageName: '@wangjs-jacky/paws',
      fetchLatestVersion,
      log: (message) => logs.push(message),
      now: () => 2000,
      checkIntervalMs: 24 * 60 * 60 * 1000,
    });

    expect(result).toBe('new-version');
    expect(fetchLatestVersion).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Paws CLI 1.2.2 is available');
  });

  it('silently ignores npm lookup failures when no cached update exists', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-cli-update-failure-'));
    const logs: string[] = [];

    const result = await promptCliUpdateIfNeeded({
      ...interactiveRuntime(),
      cacheFile: join(homeDir, 'cli-update-check.json'),
      currentVersion: '1.2.1',
      packageName: '@wangjs-jacky/paws',
      fetchLatestVersion: vi.fn(async () => {
        throw new Error('network down');
      }),
      log: (message) => logs.push(message),
      now: () => 1000,
    });

    expect(result).toBe('failed');
    expect(logs).toEqual([]);
  });

  it('writes the latest version to cache when the current version is up to date', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'happy-cli-update-current-'));
    const cacheFile = join(homeDir, 'cli-update-check.json');

    const result = await promptCliUpdateIfNeeded({
      ...interactiveRuntime(),
      cacheFile,
      currentVersion: '1.2.1',
      packageName: '@wangjs-jacky/paws',
      fetchLatestVersion: vi.fn(async () => '1.2.1'),
      now: () => 1234,
    });

    expect(result).toBe('current');
    await expect(readFile(cacheFile, 'utf8')).resolves.toContain('"latestVersion": "1.2.1"');
  });
});
