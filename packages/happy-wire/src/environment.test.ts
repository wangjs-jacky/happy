import { describe, expect, it } from 'vitest';
import {
  EnvironmentApplyResponseSchema,
  EnvironmentApplyRequestSchema,
  EnvironmentInspectRequestSchema,
} from './environment';

describe('environment wire schemas', () => {
  it('accepts a bounded scan and an optional desired state', () => {
    expect(EnvironmentInspectRequestSchema.parse({ componentIds: ['github-cli'] })).toEqual({
      componentIds: ['github-cli'],
    });
    expect(EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli'],
      desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
    }).desired?.targetVersion).toBe('2.80.0');
  });

  it('rejects arbitrary execution fields and oversized component arrays', () => {
    expect(() => EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli', 'github-cli'],
    })).toThrow();
    expect(() => EnvironmentApplyRequestSchema.parse({
      desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
      approvedAt: 1,
      plan: {
        componentId: 'github-cli',
        action: 'upgrade',
        fromVersion: '2.79.0',
        targetVersion: '2.80.0',
        planFingerprint: 'a'.repeat(64),
        expiresAt: 601_000,
      },
      command: 'rm -rf /',
    })).toThrow();
  });

  it('accepts a typed local process timeout apply result', () => {
    const observation = {
      componentId: 'github-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
      installed: true, installedVersion: '2.79.0', resolvedExecutable: '/opt/homebrew/bin/gh',
      packageManager: { kind: 'homebrew', available: true, stableVersion: '2.80.0' },
      authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: 1,
    };
    expect(EnvironmentApplyResponseSchema.parse({ result: {
      componentId: 'github-cli', status: 'failed', before: observation, after: observation,
      changed: false, reasonCode: 'process-timeout',
    } }).result.reasonCode).toBe('process-timeout');
  });
});
