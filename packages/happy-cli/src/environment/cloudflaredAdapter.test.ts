import { describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner, RunProcessOptions } from './processRunner';
import {
  createCloudflaredAdapter,
  parseCloudflaredVersion,
  type CloudflaredAdapterDeps,
} from './cloudflaredAdapter';

type Invocation = { executable: string; args: readonly string[]; options: RunProcessOptions };

function success(stdout: string): ProcessResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function testDeps(options: {
  cloudflaredPath?: string | null;
  brewPath?: string | null;
  versionResult?: ProcessResult;
  brewInfoResult?: ProcessResult;
  formulaPrefixResult?: ProcessResult;
  certificatePresent?: boolean;
  resolvedCloudflared?: string | null;
  resolvedExpected?: string | null;
} = {}): CloudflaredAdapterDeps & { invocations: Invocation[]; existenceChecks: string[] } {
  const invocations: Invocation[] = [];
  const existenceChecks: string[] = [];
  const runner: ProcessRunner = {
    async run(executable, args, runOptions) {
      invocations.push({ executable, args: [...args], options: runOptions });
      if (args[0] === '--version') return options.versionResult ?? success('cloudflared version 2026.8.3 (built 2026-08-19-1200 UTC)\n');
      if (args[0] === 'info') {
        return options.brewInfoResult
          ?? success('{"formulae":[{"versions":{"stable":"2026.8.4"}}]}');
      }
      if (args[0] === '--prefix') return options.formulaPrefixResult ?? success('/opt/homebrew/opt/cloudflared\n');
      if (args[0] === 'install' || args[0] === 'upgrade' || args[0] === 'tunnel') return success('completed\n');
      throw new Error(`unexpected invocation: ${executable} ${args.join(' ')}`);
    },
  };
  return {
    runner,
    resolveExecutable: async (name, _path, candidates) => {
      if (name === 'brew') {
        expect(candidates).toEqual(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
        return options.brewPath === undefined ? '/opt/homebrew/bin/brew' : options.brewPath;
      }
      expect(name).toBe('cloudflared');
      expect(candidates).toEqual(['/opt/homebrew/bin/cloudflared']);
      return options.cloudflaredPath === undefined ? '/opt/homebrew/bin/cloudflared' : options.cloudflaredPath;
    },
    resolveRealpath: async (path) => path === '/opt/homebrew/bin/cloudflared'
      ? options.resolvedCloudflared === undefined ? '/opt/homebrew/Cellar/cloudflared/2026.8.3/bin/cloudflared' : options.resolvedCloudflared
      : options.resolvedExpected === undefined ? '/opt/homebrew/Cellar/cloudflared/2026.8.3/bin/cloudflared' : options.resolvedExpected,
    pathExists: async (path) => {
      existenceChecks.push(path);
      return options.certificatePresent ?? true;
    },
    env: { PATH: '/test/bin' }, homeDirectory: '/Users/test',
    platform: 'darwin', architecture: 'arm64', now: () => 1_000,
    invocations, existenceChecks,
  };
}

describe('cloudflared environment adapter', () => {
  it('parses only the documented cloudflared version line', () => {
    expect(parseCloudflaredVersion('cloudflared version 2026.8.3 (built 2026-08-19-1200 UTC)\n')).toBe('2026.8.3');
    expect(parseCloudflaredVersion('cloudflared 2026.8.3')).toBeNull();
    expect(parseCloudflaredVersion('cloudflared version /Users/private/cert.pem')).toBeNull();
  });

  it('reports Homebrew versions and certificate existence without reading certificate contents', async () => {
    const deps = testDeps();
    const adapter = createCloudflaredAdapter(deps);

    const observed = await adapter.inspect();

    expect(adapter.alignment).toBe('supported');
    expect(observed).toEqual({
      componentId: 'cloudflared', platform: 'darwin', architecture: 'arm64', support: 'supported',
      installed: true, installedVersion: '2026.8.3', resolvedExecutable: '/opt/homebrew/bin/cloudflared',
      source: { kind: 'homebrew', available: true, latestVersion: '2026.8.4', ownership: 'verified' },
      capability: 'alignable',
      details: { kind: 'cloudflared', tunnelCertificatePresent: true }, inspectedAt: 1_000,
    });
    expect(deps.existenceChecks).toEqual(['/Users/test/.cloudflared/cert.pem']);
    expect(deps.invocations).toEqual([
      expect.objectContaining({ executable: '/opt/homebrew/bin/cloudflared', args: ['--version'] }),
      expect.objectContaining({ executable: '/opt/homebrew/bin/brew', args: ['info', '--json=v2', 'cloudflared'] }),
      expect.objectContaining({ executable: '/opt/homebrew/bin/brew', args: ['--prefix', 'cloudflared'] }),
    ]);
    expect(deps.invocations.every(({ options }) => (
      options.timeoutMs === 15_000 && options.maxOutputBytes === 64 * 1024
    ))).toBe(true);
    expect(JSON.stringify(observed)).not.toMatch(/cert\.pem|\/Users\/test|stdout|stderr/iu);
  });

  it('refuses mutation when the executable does not resolve into the Homebrew formula', async () => {
    const observed = await createCloudflaredAdapter(testDeps({
      resolvedCloudflared: '/opt/homebrew/bin/unmanaged-cloudflared',
    })).inspect();

    expect(observed).toMatchObject({ capability: 'inspect-only', reasonCode: 'version-source-mismatch',
      source: { ownership: 'unverified' } });
  });

  it.each([true, false])('represents certificate presence %s only as a boolean', async (certificatePresent) => {
    const deps = testDeps({ certificatePresent });

    const observed = await createCloudflaredAdapter(deps).inspect();

    expect(observed.details).toEqual({ kind: 'cloudflared', tunnelCertificatePresent: certificatePresent });
    expect(deps.existenceChecks).toEqual(['/Users/test/.cloudflared/cert.pem']);
  });

  it('preserves the local version when Homebrew latest-version lookup times out', async () => {
    const deps = testDeps({
      brewInfoResult: {
        exitCode: null, stdout: 'PRIVATE_FORMULA_OUTPUT', stderr: '/Users/private/.cloudflared/cert.pem', timedOut: true,
      },
    });

    const observed = await createCloudflaredAdapter(deps).inspect();

    expect(observed).toMatchObject({
      installed: true, installedVersion: '2026.8.3',
      source: { kind: 'homebrew', available: true, latestVersion: null, ownership: 'verified' },
      details: { kind: 'cloudflared', tunnelCertificatePresent: true }, reasonCode: 'process-timeout',
    });
    expect(JSON.stringify(observed)).not.toMatch(/PRIVATE|cert\.pem|\/Users\/private|stdout|stderr/iu);
  });

  it.each([
    ['oversized', '1'.repeat(129)],
    ['path-shaped', '/private/config'],
  ])('degrades an invalid %s Homebrew stable version to null', async (_name, invalidVersion) => {
    const deps = testDeps({
      brewInfoResult: success(JSON.stringify({ formulae: [{ versions: { stable: invalidVersion } }] })),
    });

    const observed = await createCloudflaredAdapter(deps).inspect();

    expect(observed).toMatchObject({
      installed: true, installedVersion: '2026.8.3',
      source: { kind: 'homebrew', available: true, latestVersion: null, ownership: 'verified' },
      reasonCode: 'formula-unavailable',
    });
    expect(JSON.stringify(observed)).not.toContain(invalidVersion);
  });

  it('plans and applies a Homebrew upgrade before tunnel login', async () => {
    const deps = testDeps({ certificatePresent: false });
    const adapter = createCloudflaredAdapter(deps);
    const observed = await adapter.inspect();
    const plan = adapter.plan({ componentId: 'cloudflared', targetVersion: '2026.8.4' }, observed, 1_000);

    expect(plan.action).toBe('upgrade');
    await adapter.apply(plan);
    expect(deps.invocations.at(-1)).toEqual(expect.objectContaining({
      executable: '/opt/homebrew/bin/brew', args: ['upgrade', 'cloudflared'],
    }));
  });

  it('plans and starts official tunnel login after versions align', async () => {
    const deps = testDeps({
      certificatePresent: false,
      versionResult: success('cloudflared version 2026.8.4 (built 2026-08-19-1200 UTC)\n'),
    });
    const adapter = createCloudflaredAdapter(deps);
    const observed = await adapter.inspect();
    const plan = adapter.plan({ componentId: 'cloudflared', targetVersion: '2026.8.4' }, observed, 1_000);

    expect(plan.action).toBe('authenticate');
    await adapter.apply(plan);
    expect(deps.invocations.at(-1)).toEqual(expect.objectContaining({
      executable: '/opt/homebrew/bin/cloudflared', args: ['tunnel', 'login'],
    }));
  });
});
