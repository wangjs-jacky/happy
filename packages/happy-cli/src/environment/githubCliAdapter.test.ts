import type { ComponentObservation, DesiredComponentState } from '@slopus/happy-wire';
import { describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner, RunProcessOptions } from './processRunner';
import {
  createGitHubCliAdapter,
  parseGitHubCliVersion,
  parseHomebrewStableVersion,
  type GitHubCliAdapterDeps,
} from './githubCliAdapter';

type Invocation = {
  executable: string;
  args: readonly string[];
  options: RunProcessOptions;
};

type InspectionResults = {
  ghVersion: ProcessResult;
  brewInfo: ProcessResult;
  brewPrefix?: ProcessResult;
  authStatus: ProcessResult;
};

type TestDepsOptions = {
  brewPath?: string | null;
  ghPath?: string | null;
  applyResults?: ProcessResult[];
  realpaths?: Record<string, string | null>;
};

function desired(version: string): DesiredComponentState {
  return { componentId: 'github-cli', targetVersion: version };
}

function observation(installedVersion: string | null, stableVersion: string | null): ComponentObservation {
  return {
    componentId: 'github-cli',
    platform: 'darwin',
    architecture: 'arm64',
    support: 'supported',
    installed: installedVersion !== null,
    installedVersion,
    resolvedExecutable: installedVersion === null ? null : '/opt/homebrew/bin/gh',
    packageManager: { kind: 'homebrew', available: true, stableVersion },
    authentication: { provider: 'github.com', status: 'authenticated' },
    inspectedAt: 1_000,
  };
}

function testDeps(
  results: InspectionResults,
  options: TestDepsOptions = {},
): GitHubCliAdapterDeps & { invocations: Invocation[] } {
  const queue = [
    results.ghVersion,
    results.brewInfo,
    results.brewPrefix ?? {
      exitCode: 0,
      stdout: '/opt/homebrew/Cellar/gh/2.80.0\n',
      stderr: '',
      timedOut: false,
    },
    results.authStatus,
  ];
  const applyResults = [...(options.applyResults ?? [])];
  const invocations: Invocation[] = [];
  const runner: ProcessRunner = {
    async run(executable, args, options) {
      invocations.push({ executable, args: [...args], options });
      if (options.timeoutMs === 8 * 60_000) {
        const applyResult = applyResults.shift();
        if (applyResult === undefined) throw new Error('unexpected package operation');
        return applyResult;
      }
      const result = queue.shift();
      if (result === undefined) throw new Error('unexpected process invocation');
      return result;
    },
  };

  return {
    runner,
    resolveExecutable: async (name) => {
      if (name === 'brew') return options.brewPath === undefined ? '/opt/homebrew/bin/brew' : options.brewPath;
      return options.ghPath === undefined ? '/opt/homebrew/bin/gh' : options.ghPath;
    },
    resolveRealpath: async (path) => options.realpaths?.[path]
      ?? (path === '/opt/homebrew/bin/gh' ? '/opt/homebrew/Cellar/gh/2.80.0/bin/gh' : path),
    env: {
      PATH: '/test/bin',
      GH_TOKEN: 'temporary-token',
      GITHUB_TOKEN: 'github-token',
      GH_ENTERPRISE_TOKEN: 'enterprise-token',
      GITHUB_ENTERPRISE_TOKEN: 'enterprise-github-token',
      KEEP_ME: 'safe',
    },
    platform: 'darwin',
    architecture: 'arm64',
    now: () => 1_000,
    invocations,
  };
}

describe('GitHub CLI environment adapter', () => {
  it('reports installed version, Homebrew target, and stored auth without leaking output', async () => {
    const deps = testDeps({
      ghVersion: { exitCode: 0, stdout: 'gh version 2.80.0 (2026-08-20)\n', stderr: '', timedOut: false },
      brewInfo: { exitCode: 0, stdout: '{"formulae":[{"versions":{"stable":"2.80.0"}}]}', stderr: '', timedOut: false },
      authStatus: { exitCode: 0, stdout: 'logged in as private-user', stderr: '', timedOut: false },
    });
    const adapter = createGitHubCliAdapter(deps);

    const observed = await adapter.inspect();

    expect(observed.installedVersion).toBe('2.80.0');
    expect(observed.packageManager.stableVersion).toBe('2.80.0');
    expect(observed.authentication.status).toBe('authenticated');
    expect(JSON.stringify(observed)).not.toContain('private-user');
    expect(observed.inspectedAt).toBe(1_000);
    expect(deps.invocations.map(({ executable, args }) => [executable, args])).toEqual([
      ['/opt/homebrew/bin/gh', ['--version']],
      ['/opt/homebrew/bin/brew', ['info', '--json=v2', 'gh']],
      ['/opt/homebrew/bin/brew', ['--prefix', 'gh']],
      ['/opt/homebrew/bin/gh', ['auth', 'status', '--hostname', 'github.com']],
    ]);

    const authEnvironment = deps.invocations[3]?.options.env;
    expect(authEnvironment).toMatchObject({ PATH: '/test/bin', KEEP_ME: 'safe' });
    expect(authEnvironment).not.toHaveProperty('GH_TOKEN');
    expect(authEnvironment).not.toHaveProperty('GITHUB_TOKEN');
    expect(authEnvironment).not.toHaveProperty('GH_ENTERPRISE_TOKEN');
    expect(authEnvironment).not.toHaveProperty('GITHUB_ENTERPRISE_TOKEN');
  });

  it('plans install, upgrade, no-op, and ahead-of-target without downgrade', () => {
    const adapter = createGitHubCliAdapter(testDeps({
      ghVersion: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      brewInfo: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      authStatus: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
    }));

    expect(adapter.plan(desired('2.80.0'), observation(null, '2.80.0'), 1_000)).toMatchObject({
      action: 'install', expiresAt: 601_000,
    });
    expect(adapter.plan(desired('2.80.0'), observation('2.79.0', '2.80.0'), 1_000).action).toBe('upgrade');
    expect(adapter.plan(desired('2.80.0'), observation('2.80.0', '2.80.0'), 1_000).action).toBe('none');
    expect(adapter.plan(desired('2.80.0'), observation('2.81.0', '2.80.0'), 1_000)).toMatchObject({
      action: 'manual-repair', reasonCode: 'version-ahead',
    });
    const baseline = adapter.plan(desired('2.80.0'), observation('2.79.0', '2.80.0'), 1_000).planFingerprint;
    expect(baseline).toMatch(/^[a-f0-9]{64}$/u);
    expect(adapter.plan(desired('2.80.0'), {
      ...observation('2.79.0', '2.80.0'),
      authentication: { provider: 'github.com', status: 'missing' },
      inspectedAt: 2_000,
    }, 1_000).planFingerprint).toBe(baseline);
    expect(adapter.plan(desired('2.81.0'), observation('2.79.0', '2.80.0'), 1_000).planFingerprint).not.toBe(baseline);
    expect(adapter.plan(desired('2.80.0'), {
      ...observation('2.79.1', '2.80.0'),
    }, 1_000).planFingerprint).not.toBe(baseline);
    expect(adapter.plan(desired('2.80.0'), {
      ...observation('2.79.0', '2.80.0'),
      resolvedExecutable: '/custom/bin/gh',
    }, 1_000).planFingerprint).not.toBe(baseline);
    expect(adapter.plan(desired('2.80.0'), observation('2.79.0', '2.81.0'), 1_000).planFingerprint).not.toBe(baseline);
    expect(adapter.plan(desired('2.80.0'), {
      ...observation('2.79.0', '2.80.0'),
      packageManager: { kind: 'homebrew', available: false, stableVersion: '2.80.0' },
    }, 1_000).planFingerprint).not.toBe(baseline);
  });

  it('refuses unsupported states and version-source mismatches', async () => {
    const unsupported = createGitHubCliAdapter({
      ...testDeps({
        ghVersion: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        brewInfo: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
        authStatus: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      }),
      platform: 'linux',
    });
    await expect(unsupported.inspect()).resolves.toMatchObject({
      support: 'unsupported', reasonCode: 'unsupported-platform',
    });

    const adapter = createGitHubCliAdapter(testDeps({
      ghVersion: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      brewInfo: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      authStatus: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
    }));
    expect(adapter.plan(desired('2.80.0'), observation('2.79.0', '2.81.0'), 1_000)).toMatchObject({
      action: 'manual-repair', reasonCode: 'version-source-mismatch',
    });
  });

  it('parses only the documented command formats', () => {
    expect(parseGitHubCliVersion('gh version 2.80.0 (2026-08-20)\nmore')).toBe('2.80.0');
    expect(parseGitHubCliVersion('GitHub CLI version 2.80.0')).toBeNull();
    expect(parseHomebrewStableVersion('{"formulae":[{"versions":{"stable":"2.80.0"}}]}')).toBe('2.80.0');
    expect(parseHomebrewStableVersion('{"formulae":[]}')).toBeNull();
  });

  it('requires the resolved gh executable to be owned by the selected Homebrew installation', async () => {
    const deps = testDeps({
      ghVersion: { exitCode: 0, stdout: 'gh version 2.79.0 (2026-08-20)\n', stderr: '', timedOut: false },
      brewInfo: { exitCode: 0, stdout: '{"formulae":[{"versions":{"stable":"2.80.0"}}]}', stderr: '', timedOut: false },
      authStatus: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
    }, { ghPath: '/custom/bin/gh' });
    const adapter = createGitHubCliAdapter(deps);

    const observed = await adapter.inspect();

    expect(observed).toMatchObject({
      resolvedExecutable: '/custom/bin/gh',
      reasonCode: 'version-source-mismatch',
    });
    expect(adapter.plan(desired('2.80.0'), observed, 1_000)).toMatchObject({
      action: 'manual-repair', reasonCode: 'version-source-mismatch',
    });
  });

  it('verifies Homebrew formula ownership after resolving symlinks', async () => {
    const results = {
      ghVersion: { exitCode: 0, stdout: 'gh version 2.79.0 (2026-08-20)\n', stderr: '', timedOut: false },
      brewInfo: { exitCode: 0, stdout: '{"formulae":[{"versions":{"stable":"2.80.0"}}]}', stderr: '', timedOut: false },
      brewPrefix: { exitCode: 0, stdout: '/opt/homebrew/Cellar/gh/2.80.0\n', stderr: '', timedOut: false },
      authStatus: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
    };
    const manuallyInstalled = createGitHubCliAdapter(testDeps(results, {
      realpaths: {
        '/opt/homebrew/bin/gh': '/opt/homebrew/bin/gh',
        '/opt/homebrew/Cellar/gh/2.80.0/bin/gh': '/opt/homebrew/Cellar/gh/2.80.0/bin/gh',
      },
    }));
    const homebrewSymlink = createGitHubCliAdapter(testDeps(results));

    const manuallyInstalledObservation = await manuallyInstalled.inspect();
    const homebrewSymlinkObservation = await homebrewSymlink.inspect();

    expect(manuallyInstalled.plan(desired('2.80.0'), manuallyInstalledObservation, 1_000)).toMatchObject({
      action: 'manual-repair', reasonCode: 'version-source-mismatch',
    });
    expect(homebrewSymlinkObservation.reasonCode).toBeUndefined();
    expect(homebrewSymlink.plan(desired('2.80.0'), homebrewSymlinkObservation, 1_000).action).toBe('upgrade');
  });

  it('requires a version before treating a resolved executable as installable', async () => {
    const adapter = createGitHubCliAdapter(testDeps({
      ghVersion: { exitCode: 0, stdout: 'gh version 2.81.0-rc1\n', stderr: '', timedOut: false },
      brewInfo: { exitCode: 0, stdout: '{"formulae":[{"versions":{"stable":"2.80.0"}}]}', stderr: '', timedOut: false },
      authStatus: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
    }));

    const observed = await adapter.inspect();

    expect(observed).toMatchObject({ installed: true, installedVersion: null });
    expect(adapter.plan(desired('2.80.0'), observed, 1_000)).toMatchObject({
      action: 'manual-repair', reasonCode: 'unexpected-error',
    });
  });

  it('runs only fixed Homebrew operations and rejects non-actionable plans', async () => {
    const deps = testDeps({
      ghVersion: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      brewInfo: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
      authStatus: { exitCode: 0, stdout: '', stderr: '', timedOut: false },
    }, {
      applyResults: [
        { exitCode: 0, stdout: 'installed', stderr: '', timedOut: false },
        { exitCode: 0, stdout: 'upgraded', stderr: '', timedOut: false },
      ],
    });
    const adapter = createGitHubCliAdapter(deps);
    const install = adapter.plan(desired('2.80.0'), observation(null, '2.80.0'), 1_000);
    const upgrade = adapter.plan(desired('2.80.0'), observation('2.79.0', '2.80.0'), 1_000);
    const noOp = adapter.plan(desired('2.80.0'), observation('2.80.0', '2.80.0'), 1_000);
    const manualRepair = adapter.plan(desired('2.80.0'), observation('2.81.0', '2.80.0'), 1_000);

    await expect(adapter.apply(install)).resolves.toMatchObject({ stdout: 'installed' });
    await expect(adapter.apply(upgrade)).resolves.toMatchObject({ stdout: 'upgraded' });
    const packageInvocations = deps.invocations.filter(({ options }) => options.timeoutMs === 8 * 60_000);
    expect(packageInvocations).toEqual([
      expect.objectContaining({
        executable: '/opt/homebrew/bin/brew',
        args: ['install', 'gh'],
        options: expect.objectContaining({
          timeoutMs: 8 * 60_000,
          maxOutputBytes: 64 * 1024,
          env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' }),
        }),
      }),
      expect.objectContaining({
        executable: '/opt/homebrew/bin/brew',
        args: ['upgrade', 'gh'],
        options: expect.objectContaining({
          timeoutMs: 8 * 60_000,
          maxOutputBytes: 64 * 1024,
          env: expect.objectContaining({ HOMEBREW_NO_AUTO_UPDATE: '1' }),
        }),
      }),
    ]);

    const invocationCount = deps.invocations.length;
    await expect(adapter.apply(noOp)).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '', timedOut: false });
    await expect(adapter.apply(manualRepair)).rejects.toThrow('manual-repair plans cannot be applied');
    expect(deps.invocations).toHaveLength(invocationCount);
  });
});
