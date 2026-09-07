import type {
  ComponentObservation,
  EnvironmentApplyRequest,
  EnvironmentApplyResponse,
  EnvironmentInspectResponse,
} from '@slopus/happy-wire';
import { describe, expect, it, vi } from 'vitest';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import type { RpcHandlerMap } from '@/api/rpc/types';
import type { EnvironmentService } from './environmentService';
import { registerEnvironmentHandlers } from './registerEnvironmentHandlers';

const observation: ComponentObservation = {
  componentId: 'github-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
  installed: true, installedVersion: '2.79.0', resolvedExecutable: '/opt/homebrew/bin/gh',
  packageManager: { kind: 'homebrew', available: true, stableVersion: '2.80.0' },
  authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: 100_000,
};
const validApplyRequest: EnvironmentApplyRequest = {
  desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
  plan: {
    componentId: 'github-cli', action: 'upgrade', fromVersion: '2.79.0', targetVersion: '2.80.0',
    planFingerprint: 'a'.repeat(64), expiresAt: 700_000,
  },
  approvedAt: 100_000,
};
const inspectResponse: EnvironmentInspectResponse = { observations: [observation], plans: [validApplyRequest.plan] };
const applyResponse: EnvironmentApplyResponse = {
  result: {
    componentId: 'github-cli', status: 'succeeded', before: observation,
    after: { ...observation, installedVersion: '2.80.0' }, changed: true,
  },
};

function fixture() {
  const handlers: RpcHandlerMap = new Map();
  const registrar: Pick<RpcHandlerManager, 'registerHandler'> = {
    registerHandler: (name, handler) => { handlers.set(name, handler); },
  };
  const service = {
    inspect: vi.fn<EnvironmentService['inspect']>(async () => inspectResponse),
    apply: vi.fn<EnvironmentService['apply']>(async () => applyResponse),
  };
  registerEnvironmentHandlers(registrar, service);
  return { handlers, service };
}

describe('environment RPC handlers', () => {
  it('registers only typed inspect and apply handlers and returns service responses', async () => {
    const { handlers, service } = fixture();
    expect([...handlers.keys()]).toEqual(['environment-inspect', 'environment-apply']);
    const inspectHandler = handlers.get('environment-inspect')!;
    const applyHandler = handlers.get('environment-apply')!;
    const inspectRequest = { componentIds: ['github-cli'], desired: validApplyRequest.desired };
    await expect(inspectHandler(inspectRequest)).resolves.toEqual(inspectResponse);
    expect(service.inspect).toHaveBeenCalledExactlyOnceWith(inspectRequest);
    await expect(applyHandler(validApplyRequest)).resolves.toEqual(applyResponse);
    expect(service.apply).toHaveBeenCalledExactlyOnceWith(validApplyRequest);
    expect(service.apply.mock.calls[0]?.[0]).not.toBe(validApplyRequest);
  });

  it('allows observation-only inspection', async () => {
    const { handlers, service } = fixture();
    const inspectHandler = handlers.get('environment-inspect')!;
    await expect(inspectHandler({ componentIds: ['github-cli'] })).resolves.toEqual(inspectResponse);
    expect(service.inspect).toHaveBeenCalledExactlyOnceWith({ componentIds: ['github-cli'] });
    expect(service.apply).not.toHaveBeenCalled();
  });

  it.each([
    { componentIds: ['github-cli'], command: 'whoami' },
    { componentIds: ['github-cli'], executable: '/bin/sh' },
    { componentIds: ['github-cli', 'other-cli'] },
    { componentIds: ['other-cli'] },
    { componentIds: ['github-cli', 'github-cli'] },
    { componentIds: [] },
    { componentIds: ['github-cli'], desired: { ...validApplyRequest.desired, command: 'whoami' } },
    null,
  ])('rejects invalid inspect input before calling the service: %j', async (raw) => {
    const { handlers, service } = fixture();
    const inspectHandler = handlers.get('environment-inspect')!;
    await expect(inspectHandler(raw)).rejects.toThrow();
    expect(service.inspect).not.toHaveBeenCalled();
    expect(service.apply).not.toHaveBeenCalled();
  });

  it.each([
    { ...validApplyRequest, command: 'whoami' },
    { ...validApplyRequest, executable: '/bin/sh' },
    { ...validApplyRequest, componentIds: ['github-cli', 'other-cli'] },
    { ...validApplyRequest, desired: { ...validApplyRequest.desired, componentId: 'other-cli' } },
    { ...validApplyRequest, desired: { ...validApplyRequest.desired, command: 'whoami' } },
    { ...validApplyRequest, plan: { ...validApplyRequest.plan, componentId: 'other-cli' } },
    { ...validApplyRequest, plan: { ...validApplyRequest.plan, executable: '/bin/sh' } },
    { ...validApplyRequest, approvedAt: -1 },
    null,
  ])('rejects invalid apply input before calling the service: %j', async (raw) => {
    const { handlers, service } = fixture();
    const applyHandler = handlers.get('environment-apply')!;
    await expect(applyHandler(raw)).rejects.toThrow();
    expect(service.inspect).not.toHaveBeenCalled();
    expect(service.apply).not.toHaveBeenCalled();
  });
});
