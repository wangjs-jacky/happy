import type { ComponentObservation, DesiredComponentState } from '@slopus/happy-wire';
import { describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner, RunProcessOptions } from './processRunner';
import {
  createPawsCliAdapter,
  parsePawsCliVersion,
  type PawsCliAdapterDeps,
} from './pawsCliAdapter';

type Invocation = { executable: string; args: readonly string[]; options: RunProcessOptions };

const success = (stdout: string): ProcessResult => ({ exitCode: 0, stdout, stderr: '', timedOut: false });

function pawsObservation(
  installedVersion: string | null,
  latestVersion: string | null,
  ownership: 'verified' | 'unverified' = 'verified',
): ComponentObservation {
  return {
    componentId: 'paws-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
    installed: installedVersion !== null, installedVersion,
    resolvedExecutable: installedVersion === null ? null : '/opt/npm/bin/paws',
    source: { kind: 'npm-global', available: true, latestVersion, ownership },
    capability: 'alignable', details: { kind: 'paws-cli' }, inspectedAt: 1_000,
    ...(ownership === 'verified' ? {} : { reasonCode: 'version-source-mismatch' as const }),
  };
}

function desired(version: string): DesiredComponentState {
  return { componentId: 'paws-cli', targetVersion: version };
}

function testDeps(options: {
  pawsPath?: string | null;
  npmPath?: string | null;
  pawsVersion?: ProcessResult;
  npmLatest?: ProcessResult;
  npmPrefix?: ProcessResult;
  realpaths?: Record<string, string | null>;
  applyResult?: ProcessResult;
} = {}): PawsCliAdapterDeps & { invocations: Invocation[] } {
  const invocations: Invocation[] = [];
  const runner: ProcessRunner = {
    async run(executable, args, runOptions) {
      invocations.push({ executable, args: [...args], options: runOptions });
      if (args[0] === '--version') return options.pawsVersion ?? success('happy version: 1.3.5\n');
      if (args[0] === 'view') return options.npmLatest ?? success('"1.3.6"\n');
      if (args[0] === 'prefix') return options.npmPrefix ?? success('/opt/npm\n');
      if (args[0] === 'install') return options.applyResult ?? success('installed');
      throw new Error(`unexpected invocation: ${executable} ${args.join(' ')}`);
    },
  };
  return {
    runner,
    resolveExecutable: async (name) => name === 'paws'
      ? options.pawsPath === undefined ? '/opt/npm/bin/paws' : options.pawsPath
      : options.npmPath === undefined ? '/opt/npm/bin/npm' : options.npmPath,
    resolveRealpath: async (path) => options.realpaths?.[path]
      ?? (path === '/opt/npm/bin/paws'
        ? '/opt/npm/lib/node_modules/@wangjs-jacky/paws/bin/happy.mjs'
        : path),
    env: { PATH: '/test/bin', KEEP_ME: 'safe' }, platform: 'darwin', architecture: 'arm64',
    now: () => 1_000, invocations,
  };
}

describe('Paws CLI environment adapter', () => {
  it('parses only the documented version output', () => {
    expect(parsePawsCliVersion('happy version: 1.3.5\n')).toBe('1.3.5');
    expect(parsePawsCliVersion('Starting authentication...')).toBeNull();
    expect(parsePawsCliVersion('happy version: 01.3.6\n')).toBeNull();
    expect(parsePawsCliVersion('happy version: 1.3.6-beta.01\n')).toBeNull();
  });

  it('uses only --version for Paws inspection and preserves the local version when npm latest times out', async () => {
    const deps = testDeps({
      npmLatest: { exitCode: null, stdout: 'PRIVATE_REGISTRY_OUTPUT', stderr: 'PRIVATE_ERROR', timedOut: true },
    });

    const observed = await createPawsCliAdapter(deps).inspect();

    expect(observed).toMatchObject({
      installed: true, installedVersion: '1.3.5', resolvedExecutable: '/opt/npm/bin/paws',
      source: { kind: 'npm-global', available: true, latestVersion: null, ownership: 'verified' },
      capability: 'alignable', details: { kind: 'paws-cli' }, reasonCode: 'process-timeout',
    });
    expect(JSON.stringify(observed)).not.toMatch(/PRIVATE_/u);
    expect(deps.invocations.map(({ executable, args }) => [executable, args])).toEqual([
      ['/opt/npm/bin/paws', ['--version']],
      ['/opt/npm/bin/npm', ['view', '@wangjs-jacky/paws', 'version', '--json']],
      ['/opt/npm/bin/npm', ['prefix', '-g']],
    ]);
    expect(deps.invocations.filter(({ executable }) => executable === '/opt/npm/bin/paws'))
      .toEqual([expect.objectContaining({ args: ['--version'] })]);
  });

  it('requires the resolved Paws executable realpath to be beneath the npm global prefix', async () => {
    const deps = testDeps({
      pawsPath: '/custom/bin/paws',
      realpaths: { '/custom/bin/paws': '/custom/lib/paws/index.mjs', '/opt/npm': '/opt/npm' },
    });
    const adapter = createPawsCliAdapter(deps);

    const observed = await adapter.inspect();

    expect(observed).toMatchObject({
      resolvedExecutable: '/custom/bin/paws',
      capability: 'inspect-only',
      source: { ownership: 'unverified' },
      reasonCode: 'version-source-mismatch',
    });
    expect(adapter.plan!(desired('1.3.6'), observed, 1_000)).toMatchObject({
      action: 'manual-repair', reasonCode: 'version-source-mismatch',
    });
  });

  it('does not treat a manually installed executable inside the npm prefix as package-owned', async () => {
    const deps = testDeps({
      realpaths: {
        '/opt/npm/bin/paws': '/opt/npm/bin/paws',
        '/opt/npm/lib/node_modules/@wangjs-jacky/paws/bin/happy.mjs':
          '/opt/npm/lib/node_modules/@wangjs-jacky/paws/bin/happy.mjs',
      },
    });
    const adapter = createPawsCliAdapter(deps);

    const observed = await adapter.inspect();

    expect(observed).toMatchObject({
      resolvedExecutable: '/opt/npm/bin/paws',
      source: { ownership: 'unverified' },
      reasonCode: 'version-source-mismatch',
    });
    expect(adapter.plan(desired('1.3.6'), observed, 1_000)).toMatchObject({
      action: 'manual-repair', reasonCode: 'version-source-mismatch',
    });
  });

  it('plans install, upgrade, and no-op only from verified npm-global state', () => {
    const adapter = createPawsCliAdapter(testDeps());
    const absentButVerified = {
      ...pawsObservation(null, '1.3.6'), source: {
        kind: 'npm-global' as const, available: true, latestVersion: '1.3.6', ownership: 'verified' as const,
      },
    };

    expect(adapter.plan!(desired('1.3.6'), absentButVerified, 1_000).action).toBe('install');
    expect(adapter.plan!(desired('1.3.6'), pawsObservation('1.3.5', '1.3.6'), 1_000).action).toBe('upgrade');
    expect(adapter.plan!(desired('1.3.6'), pawsObservation('1.3.6', '1.3.6'), 1_000).action).toBe('none');
    expect(adapter.plan!(desired('1.3.6'), pawsObservation('1.3.5', '1.3.6', 'unverified'), 1_000))
      .toMatchObject({ action: 'manual-repair', reasonCode: 'version-source-mismatch' });
  });

  it('uses numeric SemVer prerelease ordering to prevent downgrades', () => {
    const adapter = createPawsCliAdapter(testDeps());

    expect(adapter.plan(
      desired('1.3.6-beta.2'),
      pawsObservation('1.3.6-beta.10', '1.3.6-beta.2'),
      1_000,
    )).toMatchObject({ action: 'manual-repair', reasonCode: 'version-ahead' });
  });

  it.each(['01.3.6', '1.3.6-beta.01'])(
    'rejects invalid installed SemVer %s instead of authorizing alignment',
    (installedVersion) => {
      const adapter = createPawsCliAdapter(testDeps());

      expect(adapter.plan(
        desired('1.3.6'),
        pawsObservation(installedVersion, '1.3.6'),
        1_000,
      )).toMatchObject({ action: 'manual-repair' });
    },
  );

  it('applies only the exact approved package version through the resolved npm executable', async () => {
    const deps = testDeps();
    const adapter = createPawsCliAdapter(deps);
    const plan = adapter.plan!(desired('1.3.6'), pawsObservation('1.3.5', '1.3.6'), 1_000);

    await expect(adapter.apply!(plan)).resolves.toMatchObject({ exitCode: 0 });

    expect(deps.invocations).toEqual([
      expect.objectContaining({
        executable: '/opt/npm/bin/npm',
        args: ['install', '--global', '@wangjs-jacky/paws@1.3.6'],
        options: expect.objectContaining({ timeoutMs: 8 * 60_000, maxOutputBytes: 64 * 1024 }),
      }),
    ]);
  });
});
