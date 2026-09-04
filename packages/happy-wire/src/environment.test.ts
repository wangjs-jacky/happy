import { describe, expect, it } from 'vitest';
import {
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
});
