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
  return createEnvironmentService([adapter], now, () => {});
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

  it.each([700_000, 700_001])('re-inspects and rejects an expired plan before mutation at daemon time %i', async (expiredAt) => {
    let time = 100_000;
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter, () => time);
    const request = await validApplyRequest(service);
    expect(request.plan.expiresAt).toBe(700_000);
    time = expiredAt;
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

  it.each(['expiry', 'action', 'target'] as const)('rejects caller changes to %s', async (field) => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    if (field === 'expiry') request.plan.expiresAt += 1;
    if (field === 'action') request.plan.action = 'install';
    if (field === 'target') request.desired = { ...desired, targetVersion: '2.81.0' };
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

  it.each([
    { reasonCode: 'homebrew-missing' as const, packageManager: { kind: 'homebrew' as const, available: false, stableVersion: null } },
    { reasonCode: 'formula-unavailable' as const, packageManager: { kind: 'homebrew' as const, available: true, stableVersion: null } },
    { reasonCode: 'version-source-mismatch' as const, resolvedExecutable: '/custom/bin/gh' },
    { packageManager: { kind: 'homebrew' as const, available: true, stableVersion: '2.81.0' } },
    { reasonCode: 'formula-unavailable' as const },
    { support: 'unsupported' as const, reasonCode: 'unsupported-platform' as const },
  ])('rejects exact-target post-inspection with unverified Homebrew state: %j', async (patch) => {
    const { adapter, setState } = adapterFixture();
    adapter.apply.mockImplementationOnce(async () => {
      setState({ installedVersion: '2.80.0', ...patch });
      return success;
    });
    const logs: string[] = [];
    const service = createEnvironmentService([adapter], () => 100_000, (message) => { logs.push(message); });
    const response = await service.apply(await validApplyRequest(service));
    expect(response.result).toMatchObject({ status: 'failed', reasonCode: 'verification-failed' });
    expect(JSON.parse(logs[0]!).verification).toBe('failed');
  });

  it.each(['authenticated', 'missing'] as const)('verifies healthy exact-target state with %s authentication', async (status) => {
    const { adapter, setState } = adapterFixture();
    adapter.apply.mockImplementationOnce(async () => {
      setState({ installedVersion: '2.80.0', authentication: { provider: 'github.com', status },
        ...(status === 'missing' ? { reasonCode: 'authentication-missing' } : {}) });
      return success;
    });
    const service = serviceWithAdapter(adapter);
    expect((await service.apply(await validApplyRequest(service))).result).toMatchObject({
      status: 'succeeded', after: { authentication: { status } },
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

  it.each([70_000, 130_000])('accepts a locally valid issued preview despite client clock %i', async (approvedAt) => {
    let time = 100_000;
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter, () => time);
    const request = await validApplyRequest(service);
    time = 100_001;
    await service.inspect({ componentIds: ['github-cli'], desired });
    expect((await service.apply({ ...request, approvedAt })).result.status).toBe('succeeded');
  });

  it.each([-1, NaN, Infinity, '100000'])('rejects malformed client approval time %s at the wire boundary', async (approvedAt) => {
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter);
    const request = await validApplyRequest(service);
    await expect(service.apply({ ...request, approvedAt } as EnvironmentApplyRequest)).rejects.toThrow('Invalid environment apply request');
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('rejects a preview if the daemon clock moves before its local issuance', async () => {
    let time = 100_000;
    const { adapter } = adapterFixture();
    const service = serviceWithAdapter(adapter, () => time);
    const request = await validApplyRequest(service);
    time = 99_999;
    expect((await service.apply({ ...request, approvedAt: 70_000 })).result.status).toBe('stale-plan');
    expect(adapter.apply).not.toHaveBeenCalled();
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

  it('preserves an adapter process timeout as unknown instead of an install failure', async () => {
    const { adapter } = adapterFixture();
    adapter.apply.mockResolvedValue({ ...success, timedOut: true });
    const service = serviceWithAdapter(adapter);
    const response = await service.apply(await validApplyRequest(service));
    expect(response.result).toMatchObject({ status: 'failed', reasonCode: 'process-timeout', changed: false });
    expect(response.result.reasonCode).not.toBe('install-failed');
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

describe('environment apply lifecycle logging', () => {
  it.each([
    { scenario: 'success', exitStatus: 0, verification: 'passed', resultStatus: 'succeeded', durationMs: 35 },
    { scenario: 'no-op', exitStatus: 'not-executed', verification: 'passed', resultStatus: 'succeeded', durationMs: 35 },
    { scenario: 'stale', exitStatus: 'not-executed', verification: 'not-run', resultStatus: 'stale-plan', durationMs: 11, reasonCode: 'plan-stale' },
    { scenario: 'manual', exitStatus: 'not-executed', verification: 'not-run', resultStatus: 'manual-repair', durationMs: 11, reasonCode: 'version-ahead' },
    { scenario: 'process-failure', exitStatus: 7, verification: 'failed', resultStatus: 'failed', durationMs: 35, reasonCode: 'install-failed' },
    { scenario: 'timeout', exitStatus: 'timeout', verification: 'failed', resultStatus: 'failed', durationMs: 35, reasonCode: 'process-timeout' },
    { scenario: 'exception', exitStatus: 'error', verification: 'failed', resultStatus: 'failed', durationMs: 35, reasonCode: 'install-failed' },
    { scenario: 'verification-failure', exitStatus: 0, verification: 'failed', resultStatus: 'failed', durationMs: 35, reasonCode: 'verification-failed' },
    { scenario: 'inspection-failure', exitStatus: 'not-executed', verification: 'not-run', resultStatus: 'failed', durationMs: 11, reasonCode: 'unexpected-error' },
    { scenario: 'verification-unavailable', exitStatus: 0, verification: 'unavailable', resultStatus: 'failed', durationMs: 35, reasonCode: 'verification-failed' },
  ])('records only bounded completion fields for $scenario', async ({ scenario, ...expected }) => {
    let time = 100_000;
    const logs: string[] = [];
    const { adapter } = adapterFixture({
      ...(scenario === 'no-op' ? { installedVersion: '2.80.0' } : {}),
      ...(scenario === 'manual' ? { installedVersion: '2.81.0' } : {}),
    });
    const service = createEnvironmentService([adapter], () => time, (message: string) => { logs.push(message); });
    const request = await validApplyRequest(service);
    const inspect = adapter.inspect.getMockImplementation()!;
    let inspections = 0;
    adapter.inspect.mockImplementation(async () => {
      time += 11;
      inspections += 1;
      if (scenario === 'inspection-failure' || (scenario === 'verification-unavailable' && inspections === 2)) {
        throw new Error('PRIVATE_INSPECTION_EXCEPTION');
      }
      return inspect();
    });
    const apply = adapter.apply.getMockImplementation()!;
    adapter.apply.mockImplementation(async (plan) => {
      time += 13;
      if (scenario === 'exception') throw new Error('PRIVATE_APPLY_EXCEPTION');
      const output = { stdout: 'GH_TOKEN=PRIVATE_STDOUT', stderr: 'PRIVATE_STDERR'.repeat(2_000) };
      if (scenario === 'process-failure') return { ...success, ...output, exitCode: 7 };
      if (scenario === 'timeout') return { ...success, ...output, timedOut: true };
      if (scenario === 'verification-failure') return { ...success, ...output };
      return { ...await apply(plan), ...output };
    });
    if (scenario === 'stale') request.plan.expiresAt -= 1;

    const response = await service.apply(request);

    expect(response.result.status).toBe(expected.resultStatus);
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!)).toEqual({
      event: 'environment.apply.completed', componentId: 'github-cli', targetVersion: '2.80.0', ...expected,
    });
    expect(logs[0]!.length).toBeLessThanOrEqual(512);
    expect(logs[0]).not.toMatch(/PRIVATE_|GH_TOKEN|homebrew|authentication|planFingerprint|approvedAt|stdout|stderr/u);
  });

  it('logs contention without affecting the active operation', async () => {
    const logs: string[] = [];
    const { adapter } = adapterFixture();
    const service = createEnvironmentService([adapter], () => 100_000, (message: string) => { logs.push(message); });
    const request = await validApplyRequest(service);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = adapter.apply.getMockImplementation()!;
    adapter.apply.mockImplementationOnce(async (plan) => { await gate; return original(plan); });
    const first = service.apply(request);
    const second = await service.apply(request);
    expect(second.result.reasonCode).toBe('operation-in-progress');
    expect(logs.map((line) => JSON.parse(line))).toEqual([{
      event: 'environment.apply.completed', componentId: 'github-cli', targetVersion: '2.80.0',
      durationMs: 0, exitStatus: 'not-executed', verification: 'not-run', resultStatus: 'failed',
      reasonCode: 'operation-in-progress',
    }]);
    release();
    expect((await first).result.status).toBe('succeeded');
    expect(logs).toHaveLength(2);
  });

  it('caps log target fields independently of wire input length', async () => {
    const logs: string[] = [];
    const { adapter } = adapterFixture();
    const service = createEnvironmentService([adapter], () => 100_000, (message: string) => { logs.push(message); });
    const request = await validApplyRequest(service);
    request.desired = { ...desired, targetVersion: `2.80.0-${'a'.repeat(4_000)}` };
    expect((await service.apply(request)).result.status).toBe('stale-plan');
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]!).targetVersion).toHaveLength(64);
    expect(logs[0]!.length).toBeLessThanOrEqual(512);
  });

  it('does not let a failed log sink change results or retain the component lock', async () => {
    const { adapter } = adapterFixture();
    let logAttempts = 0;
    const service = createEnvironmentService([adapter], () => 100_000, () => {
      logAttempts += 1;
      throw new Error('PRIVATE_LOG_SINK_EXCEPTION');
    });
    const first = await service.apply(await validApplyRequest(service));
    const second = await service.apply(await validApplyRequest(service));
    expect(first.result).toMatchObject({ status: 'succeeded', changed: true });
    expect(second.result).toMatchObject({ status: 'succeeded', changed: false });
    expect(logAttempts).toBe(2);
    expect(JSON.stringify([first, second])).not.toContain('PRIVATE_LOG_SINK_EXCEPTION');
  });
});
