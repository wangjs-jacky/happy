import { describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner, RunProcessOptions } from './processRunner';
import {
  createEgoBrowserAdapter,
  parseEgoBrowserVersion,
  type EgoBrowserAdapterDeps,
} from './egoBrowserAdapter';

type Invocation = { executable: string; args: readonly string[]; options: RunProcessOptions };

const versionOutput = 'ego-browser 0.4.7.4\n  chromium 150.0.7871.101\n  node v24.18.0\n';

function success(stdout: string): ProcessResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function successOnStderr(stderr: string): ProcessResult {
  return { exitCode: 0, stdout: '', stderr, timedOut: false };
}

function testDeps(options: {
  egoPath?: string | null;
  appVersions?: Record<string, string | null>;
  versionResult?: ProcessResult;
} = {}): EgoBrowserAdapterDeps & { invocations: Invocation[]; plistReads: string[] } {
  const invocations: Invocation[] = [];
  const plistReads: string[] = [];
  const runner: ProcessRunner = {
    async run(executable, args, runOptions) {
      invocations.push({ executable, args: [...args], options: runOptions });
      if (args.length === 1 && args[0] === '--version') return options.versionResult ?? success(versionOutput);
      if (args.length === 1 && (args[0] === 'onboarding' || args[0] === 'upgrade')) return success('completed\n');
      throw new Error(`unexpected invocation: ${executable} ${args.join(' ')}`);
    },
  };
  return {
    runner,
    resolveExecutable: async (name) => {
      expect(name).toBe('ego-browser');
      return options.egoPath === undefined ? '/Users/test/.local/bin/ego-browser' : options.egoPath;
    },
    readPlistValue: async (path, key) => {
      plistReads.push(path);
      expect(key).toBe('CFBundleShortVersionString');
      return options.appVersions?.[path] ?? null;
    },
    env: { PATH: '/test/bin' }, homeDirectory: '/Users/test', platform: 'darwin', architecture: 'arm64', now: () => 1_000,
    invocations, plistReads,
  };
}

describe('Ego browser environment adapter', () => {
  it('reports PATH unready when only the documented fallback exists', async () => {
    const deps = testDeps({ appVersions: { '/Applications/Ego Lite.app/Contents/Info.plist': '0.4.7.4' } });
    const observed = await createEgoBrowserAdapter({ ...deps, env: { PATH: '/usr/bin' },
      resolveExecutable: async (_name, path, candidates) => {
        expect(path === '/usr/bin' || path === undefined).toBe(true);
        return candidates?.includes('/Users/test/.local/bin/ego-browser') ? '/Users/test/.local/bin/ego-browser' : null;
      },
    }).inspect();
    expect(observed).toMatchObject({ installed: true, installedVersion: '0.4.7.4',
      details: { appVersion: '0.4.7.4', pathReady: false, paired: false } });
    expect(deps.invocations.map(({ args }) => args)).toEqual([['--version']]);
    expect(deps.invocations[0].options).toMatchObject({ timeoutMs: 15_000, maxOutputBytes: 64 * 1024 });
  });

  it('keeps CLI versions but marks the macOS app check unsupported on Linux', async () => {
    const deps = testDeps({ appVersions: { '/Applications/Ego Lite.app/Contents/Info.plist': '0.4.7.4' } });
    const observed = await createEgoBrowserAdapter({ ...deps, platform: 'linux' }).inspect();
    expect(observed).toMatchObject({ support: 'unsupported', installedVersion: '0.4.7.4',
      reasonCode: 'unsupported-platform', details: { pathReady: true, appVersion: null, paired: false } });
    expect(deps.plistReads).toEqual([]);
    expect(deps.invocations.map(({ args }) => args)).toEqual([['--version']]);
  });
  it('parses the documented CLI, Chromium, and Node version output', () => {
    expect(parseEgoBrowserVersion(versionOutput)).toEqual({
      cliVersion: '0.4.7.4', chromiumVersion: '150.0.7871.101', nodeVersion: '24.18.0',
    });
  });

  it('reads the documented version output when the native CLI writes it to stderr', async () => {
    const observed = await createEgoBrowserAdapter(testDeps({
      appVersions: { '/Applications/Ego Lite.app/Contents/Info.plist': '0.4.7.4' },
      versionResult: successOnStderr(versionOutput),
    })).inspect();

    expect(observed).toMatchObject({ installedVersion: '0.4.7.4', capability: 'alignable',
      details: { chromiumVersion: '150.0.7871.101', nodeVersion: '24.18.0', paired: true } });
  });

  it.each([
    'chromium 150.0.7871.101\nnode v24.18.0\n',
    'ego-browser 0.4.7.4\nchromium 150.0.7871.101\nnode 24.18.0\n',
    'not an Ego version\n',
  ])('rejects malformed version output', (stdout) => {
    expect(parseEgoBrowserVersion(stdout)).toBeNull();
  });

  it('rejects CLI versions that exceed the wire version bound', () => {
    const oversizedVersion = `1.${'2'.repeat(127)}`;

    expect(parseEgoBrowserVersion(
      `ego-browser ${oversizedVersion}\nchromium ${oversizedVersion}\nnode v${oversizedVersion}\n`,
    )).toBeNull();
  });

  it('inspects only the version command and pairs matching app and CLI versions', async () => {
    const systemPlist = '/Applications/Ego Lite.app/Contents/Info.plist';
    const deps = testDeps({ appVersions: { [systemPlist]: '0.4.7.4' } });

    const adapter = createEgoBrowserAdapter(deps);
    const observed = await adapter.inspect();

    expect(adapter.alignment).toBe('supported');
    expect(observed).toMatchObject({
      componentId: 'ego-browser', installed: true, installedVersion: '0.4.7.4',
      resolvedExecutable: '/Users/test/.local/bin/ego-browser',
      source: { kind: 'app-managed', available: true, latestVersion: '0.4.7.4', ownership: 'not-applicable' },
      capability: 'alignable',
      details: {
        kind: 'ego-browser', appVersion: '0.4.7.4', chromiumVersion: '150.0.7871.101', nodeVersion: '24.18.0', paired: true,
      },
      inspectedAt: 1_000,
    });
    expect(deps.invocations).toEqual([
      expect.objectContaining({ executable: '/Users/test/.local/bin/ego-browser', args: ['--version'] }),
    ]);
    expect(deps.invocations.every(({ args }) => args.length === 1 && args[0] === '--version')).toBe(true);
    expect(JSON.stringify(deps.invocations)).not.toMatch(/nodejs|task|space|page|profile/iu);
    expect(deps.plistReads).toEqual([systemPlist]);
  });

  it('reports a missing CLI without running Ego', async () => {
    const deps = testDeps({ egoPath: null });

    await expect(createEgoBrowserAdapter(deps).inspect()).resolves.toMatchObject({
      installed: false, installedVersion: null, resolvedExecutable: null,
      details: { appVersion: null, chromiumVersion: null, nodeVersion: null, paired: false },
      reasonCode: 'unexpected-error',
    });
    expect(deps.invocations).toEqual([]);
  });

  it('reports a missing app without claiming that the CLI is paired', async () => {
    const deps = testDeps();

    await expect(createEgoBrowserAdapter(deps).inspect()).resolves.toMatchObject({
      installed: true, installedVersion: '0.4.7.4',
      details: { appVersion: null, chromiumVersion: '150.0.7871.101', nodeVersion: '24.18.0', paired: false },
      reasonCode: 'unexpected-error',
    });
  });

  it('flags mismatched app and CLI versions', async () => {
    const deps = testDeps({ appVersions: { '/Applications/Ego Lite.app/Contents/Info.plist': '0.4.7.3' } });

    await expect(createEgoBrowserAdapter(deps).inspect()).resolves.toMatchObject({
      installedVersion: '0.4.7.4', details: { appVersion: '0.4.7.3', paired: false },
      reasonCode: 'version-source-mismatch',
    });
  });

  it('keeps an app-managed CLI outside the daemon PATH as manual repair', async () => {
    const deps = testDeps({ appVersions: { '/Applications/Ego Lite.app/Contents/Info.plist': '0.4.7.4' } });
    const adapter = createEgoBrowserAdapter({ ...deps, env: { PATH: '/usr/bin' },
      resolveExecutable: async (_name, path, candidates) => candidates.includes('/Users/test/.local/bin/ego-browser')
        ? '/Users/test/.local/bin/ego-browser' : path === '/usr/bin' ? null : null,
    });
    const observed = await adapter.inspect();
    const desired = { componentId: 'ego-browser' as const, targetVersion: '0.4.7.4' };
    const plan = adapter.plan(desired, observed, 1_000);

    expect(plan).toMatchObject({ action: 'manual-repair', reasonCode: 'unexpected-error' });
    expect(deps.invocations).not.toContainEqual(expect.objectContaining({ args: ['onboarding'] }));
  });

  it('plans and applies the official self-updater for an app and CLI mismatch', async () => {
    const deps = testDeps({ appVersions: { '/Applications/Ego Lite.app/Contents/Info.plist': '0.4.7.5' } });
    const adapter = createEgoBrowserAdapter(deps);
    const observed = await adapter.inspect();
    const plan = adapter.plan({ componentId: 'ego-browser', targetVersion: '0.4.7.5' }, observed, 1_000);

    expect(plan.action).toBe('upgrade');
    await adapter.apply(plan);
    expect(deps.invocations.at(-1)).toEqual(expect.objectContaining({
      executable: '/Users/test/.local/bin/ego-browser', args: ['upgrade'],
    }));
  });

  it('drops oversized plist versions instead of returning an invalid wire observation', async () => {
    const oversizedVersion = `1.${'2'.repeat(127)}`;
    const deps = testDeps({ appVersions: { '/Applications/Ego Lite.app/Contents/Info.plist': oversizedVersion } });

    const observed = await createEgoBrowserAdapter(deps).inspect();

    expect(observed).toMatchObject({
      installedVersion: '0.4.7.4', source: { available: false, latestVersion: null },
      details: { appVersion: null, chromiumVersion: '150.0.7871.101', nodeVersion: '24.18.0', paired: false },
      reasonCode: 'unexpected-error',
    });
    expect(JSON.stringify(observed)).not.toContain(oversizedVersion);
  });
});
