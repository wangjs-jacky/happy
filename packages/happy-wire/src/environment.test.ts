import { describe, expect, it } from 'vitest';
import {
  EnvironmentApplyResponseSchema,
  EnvironmentApplyRequestSchema,
  EnvironmentInspectRequestSchema,
  ComponentObservationSchema,
  ComponentPlanSchema,
  EnvironmentInspectResponseSchema,
} from './environment';

describe('environment wire schemas', () => {
  const githubObservation = {
    componentId: 'github-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
    installed: true, installedVersion: '2.79.0', resolvedExecutable: '/opt/homebrew/bin/gh',
    source: { kind: 'homebrew', available: true, latestVersion: '2.80.0', ownership: 'verified' },
    capability: 'alignable',
    authentication: { provider: 'github.com', status: 'authenticated', principal: 'octo•••' },
    details: { kind: 'github-cli' }, inspectedAt: 1,
  };
  const pawsObservation = {
    componentId: 'paws-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
    installed: true, installedVersion: '1.0.0', resolvedExecutable: '/usr/local/bin/paws',
    source: { kind: 'npm-global', available: true, latestVersion: '1.1.0', ownership: 'verified' },
    capability: 'alignable', details: { kind: 'paws-cli' }, inspectedAt: 1,
  };
  const egoObservation = {
    componentId: 'ego-browser', platform: 'darwin', architecture: 'arm64', support: 'supported',
    installed: true, installedVersion: '1.0.0', resolvedExecutable: '/Users/test/.local/bin/ego-browser',
    source: { kind: 'app-managed', available: true, latestVersion: null, ownership: 'not-applicable' },
    capability: 'inspect-only',
    details: { kind: 'ego-browser', appVersion: '1.0.0', chromiumVersion: '136.0.0', nodeVersion: '22.0.0', pathReady: true, paired: true },
    inspectedAt: 1,
  };
  const wranglerObservation = {
    componentId: 'cloudflare-wrangler', platform: 'darwin', architecture: 'arm64', support: 'supported',
    installed: true, installedVersion: '4.0.0', resolvedExecutable: '/usr/local/bin/wrangler',
    source: { kind: 'npm-global', available: true, latestVersion: '4.1.0', ownership: 'unverified' },
    capability: 'inspect-only',
    authentication: { provider: 'cloudflare', status: 'authenticated', accountLabels: ['Example account'] },
    details: { kind: 'cloudflare-wrangler' }, inspectedAt: 1,
  };
  const cloudflaredObservation = {
    componentId: 'cloudflared', platform: 'darwin', architecture: 'arm64', support: 'supported',
    installed: true, installedVersion: '2026.1.0', resolvedExecutable: '/opt/homebrew/bin/cloudflared',
    source: { kind: 'homebrew', available: true, latestVersion: '2026.2.0', ownership: 'verified' },
    capability: 'inspect-only', details: { kind: 'cloudflared', tunnelCertificatePresent: true }, inspectedAt: 1,
  };

  it('accepts all component detail variants and a five-component scan', () => {
    expect(ComponentObservationSchema.parse(githubObservation).details).toEqual({ kind: 'github-cli' });
    expect(ComponentObservationSchema.parse(pawsObservation).details).toEqual({ kind: 'paws-cli' });
    expect(ComponentObservationSchema.parse(egoObservation).details.kind).toBe('ego-browser');
    expect(ComponentObservationSchema.parse(wranglerObservation).authentication?.accountLabels).toEqual(['Example account']);
    expect(ComponentObservationSchema.parse(cloudflaredObservation).details).toEqual({ kind: 'cloudflared', tunnelCertificatePresent: true });
    expect(EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'],
    }).componentIds).toHaveLength(5);
  });

  it('accepts an optional desired state', () => {
    expect(EnvironmentInspectRequestSchema.parse({ componentIds: ['github-cli'] })).toEqual({
      componentIds: ['github-cli'],
    });
    expect(EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli'],
      desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
    }).desired?.targetVersion).toBe('2.80.0');
  });

  it('accepts inspect-only Paws observations for unverified installations', () => {
    expect(ComponentObservationSchema.safeParse({ ...pawsObservation, capability: 'inspect-only',
      source: { ...pawsObservation.source, ownership: 'unverified' },
      reasonCode: 'version-source-mismatch',
    }).success).toBe(true);
  });

  it('requires bounded boolean Ego PATH readiness and keeps details strict', () => {
    const withPath = { ...egoObservation, details: { ...egoObservation.details, pathReady: false, paired: false } };
    expect(ComponentObservationSchema.safeParse(withPath).success).toBe(true);
    const { pathReady: _pathReady, ...missingPath } = withPath.details;
    expect(ComponentObservationSchema.safeParse({ ...withPath, details: missingPath }).success).toBe(false);
    expect(ComponentObservationSchema.safeParse({ ...withPath, details: { ...withPath.details, pathReady: 'yes' } }).success).toBe(false);
    expect(ComponentObservationSchema.safeParse({ ...withPath, details: { ...withPath.details, stdout: 'private' } }).success).toBe(false);
  });

  it('rejects duplicate and oversized component arrays and arbitrary execution fields', () => {
    expect(() => EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli', 'github-cli'],
    })).toThrow();
    expect(() => EnvironmentInspectRequestSchema.parse({
      componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared', 'github-cli'],
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

  it('rejects raw output, account IDs, and more than eight account labels', () => {
    expect(() => ComponentObservationSchema.parse({
      ...pawsObservation,
      stdout: 'secret process output',
    })).toThrow();
    expect(() => ComponentObservationSchema.parse({
      ...wranglerObservation,
      authentication: { provider: 'cloudflare', status: 'authenticated', accountId: 'abc123' },
    })).toThrow();
    expect(() => ComponentObservationSchema.parse({
      ...wranglerObservation,
      authentication: {
        provider: 'cloudflare', status: 'authenticated',
        accountLabels: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
      },
    })).toThrow();
  });

  it('accepts a five-component inspect response', () => {
    expect(EnvironmentInspectResponseSchema.parse({
      observations: [githubObservation, pawsObservation, egoObservation, wranglerObservation, cloudflaredObservation],
    }).observations).toHaveLength(5);
  });

  it('limits alignment requests and plans to GitHub CLI and Paws CLI', () => {
    expect(() => EnvironmentInspectRequestSchema.parse({
      componentIds: ['ego-browser'],
      desired: { componentId: 'ego-browser', targetVersion: '1.0.0' },
    })).toThrow();
    expect(() => ComponentPlanSchema.parse({
      componentId: 'cloudflared', action: 'upgrade', fromVersion: '2026.1.0', targetVersion: '2026.2.0',
      planFingerprint: 'a'.repeat(64), expiresAt: 601_000,
    })).toThrow();
    expect(() => ComponentObservationSchema.parse({ ...egoObservation, capability: 'alignable' })).toThrow();
  });

  it('couples an observation component ID to its details kind', () => {
    expect(() => ComponentObservationSchema.parse({
      ...pawsObservation,
      details: { kind: 'github-cli' },
    })).toThrow();
  });

  it('rejects email addresses and full Cloudflare account IDs in authentication display fields', () => {
    for (const sensitiveValue of ['owner@example.com', '0123456789abcdef0123456789abcdef']) {
      expect(() => ComponentObservationSchema.parse({
        ...wranglerObservation,
        authentication: { provider: 'cloudflare', status: 'authenticated', principal: sensitiveValue },
      })).toThrow();
      expect(() => ComponentObservationSchema.parse({
        ...wranglerObservation,
        authentication: { provider: 'cloudflare', status: 'authenticated', accountLabels: [sensitiveValue] },
      })).toThrow();
    }
  });

  it('accepts a typed local process timeout apply result', () => {
    expect(EnvironmentApplyResponseSchema.parse({ result: {
      componentId: 'github-cli', status: 'failed', before: githubObservation, after: githubObservation,
      changed: false, reasonCode: 'process-timeout',
    } }).result.reasonCode).toBe('process-timeout');
  });
});
