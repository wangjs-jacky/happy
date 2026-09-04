import {
  EnvironmentApplyResponseSchema,
  EnvironmentInspectResponseSchema,
  type ComponentObservation,
  type ComponentPlan,
  type DesiredComponentState,
  type EnvironmentApplyRequest,
} from '@slopus/happy-wire';
import { describe, expect, it, vi } from 'vitest';
import type { EnvironmentComponentAdapter } from './componentAdapter';
import { createGitHubCliAdapter } from './githubCliAdapter';
import type { ProcessResult } from './processRunner';
import { createEnvironmentService } from './environmentService';

const desired: DesiredComponentState = { componentId: 'github-cli', targetVersion: '2.80.0' };
const success: ProcessResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

function adapterFixture(overrides: Partial<ComponentObservation> = {}) {
  let state: ComponentObservation = {
    componentId: 'github-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
    installed: true, installedVersion: '2.79.0', resolvedExecutable: '/opt/homebrew/bin/gh',
    packageManager: { kind: 'homebrew', available: true, stableVersion: '2.80.0' },
    authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: 100_000,
    ...overrides,
  };
  // Real planning; only injected inspection/mutation touches simulated machine state.
  const planner = createGitHubCliAdapter({
    runner: { run: async () => { throw new Error('fixture must not run processes'); } },
    resolveExecutable: async () => null, resolveRealpath: async () => null,
    env: {}, platform: 'darwin', architecture: 'arm64', now: () => 100_000,
  });
  const adapter = {
    id: 'github-cli' as const,
    inspect: vi.fn(async () => structuredClone(state)),
    plan: vi.fn(planner.plan),
    apply: vi.fn(async (plan: ComponentPlan) => {
      state = { ...state, installed: true, installedVersion: plan.targetVersion };
      return success;
    }),
  } satisfies EnvironmentComponentAdapter;
  return { adapter, setState: (patch: Partial<ComponentObservation>) => { state = { ...state, ...patch }; } };
}

function serviceWithAdapter(adapter: EnvironmentComponentAdapter, now = () => 100_000) {
  return createEnvironmentService([adapter], now);
}

async function validApplyRequest(service: ReturnType<typeof createEnvironmentService>): Promise<EnvironmentApplyRequest> {
  const preview = await service.inspect({ componentIds: ['github-cli'], desired });
  EnvironmentInspectResponseSchema.parse(preview);
  return { desired, plan: preview.plans![0]!, approvedAt: 100_000 };
}

describe('environment service authorization and verification', () => {
  it('previews observations without requiring a desired version', async () => {
    const { adapter } = adapterFixture();
    const response = await serviceWithAdapter(adapter).inspect({ componentIds: ['github-cli'] });
    expect(response.observations[0]?.installedVersion).toBe('2.79.0');
    expect(response.plans).toBeUndefined();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('re-inspects and rejects an expired plan before mutation', async () => {
    let time = 100_000;
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter, () => time);
    const request = await validApplyRequest(service);
    expect(request.plan.expiresAt).toBe(700_000);
    time = 700_001;
    const response = await service.apply(request);
    expect(response.result).toMatchObject({ status: 'stale-plan', reasonCode: 'plan-stale', changed: false });
    expect(adapter.inspect).toHaveBeenCalledTimes(2);
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it.each([
    { installedVersion: '2.79.1' },
    { resolvedExecutable: '/custom/bin/gh' },
    { packageManager: { kind: 'homebrew' as const, available: true, stableVersion: '2.81.0' } },
  ])('rejects changed install-critical state: %j', async (patch) => {
    const { adapter, setState } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    setState(patch);
    expect((await service.apply(request)).result.status).toBe('stale-plan');
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('rejects plans never issued by this service', async () => {
    const { adapter } = adapterFixture();
    const request = await validApplyRequest(serviceWithAdapter(adapter));
    const response = await serviceWithAdapter(adapter).apply(request);
    expect(response.result.status).toBe('stale-plan');
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it.each(['expiry', 'action', 'target', 'approval'] as const)('rejects caller changes to %s', async (field) => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    if (field === 'expiry') request.plan.expiresAt += 1;
    if (field === 'action') request.plan.action = 'install';
    if (field === 'target') request.desired = { ...desired, targetVersion: '2.81.0' };
    if (field === 'approval') request.approvedAt = 99_999;
    expect((await service.apply(request)).result.status).toBe('stale-plan');
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('serializes apply per component through independent verification', async () => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    let releaseApply!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseApply = resolve; });
    const original = adapter.apply.getMockImplementation()!;
    adapter.apply.mockImplementationOnce(async (plan) => { await blocked; return original(plan); });
    const first = service.apply(request);
    const second = await service.apply(request);
    expect(second.result).toMatchObject({ status: 'failed', reasonCode: 'operation-in-progress', changed: false });
    releaseApply();
    expect((await first).result.status).toBe('succeeded');
    expect(adapter.apply).toHaveBeenCalledTimes(1);
  });

  it('verifies exact target after mutation and is idempotent on the next run', async () => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const first = await service.apply(await validApplyRequest(service));
    expect(first.result).toMatchObject({ status: 'succeeded', changed: true, after: { installedVersion: '2.80.0' } });
    EnvironmentApplyResponseSchema.parse(first);
    const next = await validApplyRequest(service);
    expect(next.plan.action).toBe('none');
    expect((await service.apply(next)).result).toMatchObject({ status: 'succeeded', changed: false });
  });

  it('does not trust successful process exit without target verification', async () => {
    const { adapter } = adapterFixture();
    adapter.apply.mockResolvedValue(success);
    const service = serviceWithAdapter(adapter);
    expect((await service.apply(await validApplyRequest(service))).result).toMatchObject({
      status: 'failed', reasonCode: 'verification-failed', changed: false,
    });
  });

  it('keeps the lock until post-operation inspection settles', async () => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    let releaseInspection!: () => void;
    let inspectionStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseInspection = resolve; });
    const started = new Promise<void>((resolve) => { inspectionStarted = resolve; });
    const original = adapter.inspect.getMockImplementation()!;
    adapter.inspect.mockImplementationOnce(original).mockImplementationOnce(async () => {
      inspectionStarted();
      await blocked;
      return original();
    });
    const first = service.apply(request);
    await started;
    expect((await service.apply(request)).result.reasonCode).toBe('operation-in-progress');
    releaseInspection();
    expect((await first).result.status).toBe('succeeded');
  });

  it('does not claim a detected change when post-operation inspection is unavailable', async () => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    adapter.inspect.mockImplementationOnce(adapter.inspect.getMockImplementation()!)
      .mockRejectedValueOnce(new Error('private inspection data'));
    const response = await service.apply(request);
    expect(response.result).toMatchObject({ status: 'failed', reasonCode: 'verification-failed', changed: false });
    expect(JSON.stringify(response)).not.toContain('private inspection data');
    EnvironmentApplyResponseSchema.parse(response);
    expect((await service.apply(await validApplyRequest(service))).result.status).toBe('succeeded');
  });

  it('rejects future approval times and retains valid previews across another inspection', async () => {
    let time = 100_000;
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter, () => time);
    const request = await validApplyRequest(service);
    expect((await service.apply({ ...request, approvedAt: 100_001 })).result.status).toBe('stale-plan');
    time = 100_001;
    await service.inspect({ componentIds: ['github-cli'], desired });
    expect((await service.apply(request)).result.status).toBe('succeeded');
  });

  it('bounds issued previews and requires a fresh inspection after oldest-preview eviction', async () => {
    let time = 100_000;
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter, () => time);
    const oldest = await validApplyRequest(service);
    for (let i = 0; i < 128; i += 1) {
      time += 1;
      await service.inspect({ componentIds: ['github-cli'], desired });
    }
    expect((await service.apply(oldest)).result.status).toBe('stale-plan');
    expect(adapter.apply).not.toHaveBeenCalled();
    const preview = await service.inspect({ componentIds: ['github-cli'], desired });
    expect((await service.apply({ desired, plan: preview.plans![0]!, approvedAt: time })).result.status).toBe('succeeded');
  });

  it('snapshots approved input before awaiting inspection', async () => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    const applying = service.apply(request);
    request.plan.action = 'manual-repair';
    request.desired = { ...desired, targetVersion: '2.81.0' };
    expect((await applying).result).toMatchObject({ status: 'succeeded', after: { installedVersion: '2.80.0' } });
    expect(adapter.apply).toHaveBeenCalledWith(expect.objectContaining({ action: 'upgrade', targetVersion: '2.80.0' }));
  });

  it('surfaces inspection failure without leaking exceptions and allows another attempt', async () => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    adapter.inspect.mockRejectedValueOnce(new Error('private-token'));
    const response = await service.apply(request);
    expect(response.result).toMatchObject({ status: 'failed', reasonCode: 'unexpected-error', changed: false });
    expect(JSON.stringify(response)).not.toContain('private-token');
    expect(adapter.apply).not.toHaveBeenCalled();
    expect((await service.apply(request)).result.status).toBe('succeeded');
  });

  it('sanitizes planning exceptions at the preview boundary', async () => {
    const { adapter } = adapterFixture();
    adapter.plan.mockImplementationOnce(() => { throw new Error('private-token'); });
    await expect(serviceWithAdapter(adapter).inspect({ componentIds: ['github-cli'], desired }))
      .rejects.not.toThrow(/private-token/u);
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it.each([
    { installedVersion: '2.81.0', reasonCode: 'version-ahead' as const },
    { support: 'unsupported' as const, reasonCode: 'unsupported-platform' as const },
    { reasonCode: 'version-source-mismatch' as const },
  ])('returns structured manual repair and never mutates: %j', async (patch) => {
    const { adapter } = adapterFixture(patch);
    const service = serviceWithAdapter(adapter);
    const response = await service.apply(await validApplyRequest(service));
    expect(response.result).toMatchObject({ status: 'manual-repair', reasonCode: patch.reasonCode,
      repairGuide: { channel: 'local-terminal', reasonCode: patch.reasonCode } });
    expect(adapter.apply).not.toHaveBeenCalled();
    EnvironmentApplyResponseSchema.parse(response);
  });

  it('returns only bounded sanitized diagnostics and reinspects process failures', async () => {
    const { adapter } = adapterFixture();
    adapter.apply.mockResolvedValue({ ...success, exitCode: 1, stdout: 'GH_TOKEN=private-token', stderr: 'secret '.repeat(2_000) });
    const service = serviceWithAdapter(adapter);
    const response = await service.apply(await validApplyRequest(service));
    expect(response.result).toMatchObject({ status: 'failed', reasonCode: 'install-failed' });
    expect(adapter.inspect).toHaveBeenCalledTimes(3);
    expect(response.result.diagnosticSummary!.length).toBeLessThanOrEqual(2048);
    expect(JSON.stringify(response)).not.toMatch(/private-token|secret|GH_TOKEN/);
    EnvironmentApplyResponseSchema.parse(response);
  });

  it('reinspects exceptions, sanitizes them, and releases the lock for retry', async () => {
    const { adapter } = adapterFixture();
    adapter.apply.mockRejectedValueOnce(new Error('token=private-token'));
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    const failed = await service.apply(request);
    expect(failed.result.status).toBe('failed');
    expect(adapter.inspect).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(failed)).not.toContain('private-token');
    expect((await service.apply(request)).result.status).toBe('succeeded');
  });

  it('rejects unregistered and arbitrary request input before invoking adapters', async () => {
    const { adapter } = adapterFixture();
    expect(() => createEnvironmentService([adapter, adapter])).toThrow();
    await expect(createEnvironmentService([]).inspect({ componentIds: ['github-cli'] })).rejects.toThrow();
    await expect(serviceWithAdapter(adapter).inspect({ componentIds: ['shell'] } as never)).rejects.toThrow();
    await expect(serviceWithAdapter(adapter).apply({ desired, command: 'rm -rf /' } as never)).rejects.toThrow();
    expect(adapter.inspect).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });
});
