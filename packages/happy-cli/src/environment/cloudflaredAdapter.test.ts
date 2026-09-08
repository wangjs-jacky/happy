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
  certificatePresent?: boolean;
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

    expect(adapter.alignment).toBe('inspect-only');
    expect(observed).toEqual({
      componentId: 'cloudflared', platform: 'darwin', architecture: 'arm64', support: 'supported',
      installed: true, installedVersion: '2026.8.3', resolvedExecutable: '/opt/homebrew/bin/cloudflared',
      source: { kind: 'homebrew', available: true, latestVersion: '2026.8.4', ownership: 'not-applicable' },
      capability: 'inspect-only',
      details: { kind: 'cloudflared', tunnelCertificatePresent: true }, inspectedAt: 1_000,
    });
    expect(deps.existenceChecks).toEqual(['/Users/test/.cloudflared/cert.pem']);
    expect(deps.invocations).toEqual([
      expect.objectContaining({ executable: '/opt/homebrew/bin/cloudflared', args: ['--version'] }),
      expect.objectContaining({ executable: '/opt/homebrew/bin/brew', args: ['info', '--json=v2', 'cloudflared'] }),
    ]);
    expect(deps.invocations.every(({ options }) => (
      options.timeoutMs === 15_000 && options.maxOutputBytes === 64 * 1024
    ))).toBe(true);
    expect(JSON.stringify(observed)).not.toMatch(/cert\.pem|\/Users\/test|stdout|stderr/iu);
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
      source: { kind: 'homebrew', available: true, latestVersion: null, ownership: 'not-applicable' },
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
      source: { kind: 'homebrew', available: true, latestVersion: null, ownership: 'not-applicable' },
      reasonCode: 'formula-unavailable',
    });
    expect(JSON.stringify(observed)).not.toContain(invalidVersion);
  });
});
