// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentObservation, ComponentPlan, EnvironmentComponentId, EnvironmentInspectResponse, EnvironmentApplyResponse } from '@slopus/happy-wire';
import type { Machine } from '@/sync/storageTypes';
import { applyMachineEnvironment, inspectMachineEnvironment } from '@/environment/environmentOps';
import { useDeviceEnvironment, type DeviceEnvironmentController, type DeviceEnvironmentDependencies } from './useDeviceEnvironment';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { machineRPC: rpc } }));

function machine(id: string, active = true): Machine {
    return { id, active, seq: 1, createdAt: 0, updatedAt: 0, activeAt: 0,
        metadata: null, metadataVersion: 0, daemonState: null, daemonStateVersion: 0 };
}

function response(action?: ComponentPlan['action'], version = '2.80.0'): EnvironmentInspectResponse {
    const installedVersion = action === 'install' ? null : action === 'none' ? version : '2.79.0';
    return {
        observations: [{ componentId: 'github-cli', platform: 'darwin', architecture: 'arm64',
            support: 'supported', installed: action !== 'install', installedVersion,
            resolvedExecutable: action === 'install' ? null : '/opt/homebrew/bin/gh',
            source: { kind: 'homebrew', available: true, latestVersion: version, ownership: 'verified' },
            capability: 'alignable', details: { kind: 'github-cli' },
            authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: 1_000_000 }],
        ...(action ? { plans: [{ componentId: 'github-cli', action, fromVersion: installedVersion, targetVersion: version,
            planFingerprint: 'a'.repeat(64), expiresAt: 1_600_000,
            ...(action === 'manual-repair' ? { reasonCode: 'authentication-missing' as const } : {}) }] } : {}),
    };
}

function multiResponse(action?: ComponentPlan['action'], componentId: EnvironmentComponentId = 'paws-cli'): EnvironmentInspectResponse {
    const github = response(componentId === 'github-cli' ? action : undefined);
    const base = github.observations[0];
    const paws: ComponentObservation = { ...base, componentId: 'paws-cli', capability: 'alignable',
        details: { kind: 'paws-cli' }, installedVersion: '1.5.0',
        source: { kind: 'npm-global', available: true, latestVersion: '1.6.0', ownership: 'verified' } };
    const ego: ComponentObservation = { ...base, componentId: 'ego-browser', capability: 'inspect-only',
        source: { kind: 'app-managed', available: true, latestVersion: null, ownership: 'not-applicable' },
        details: { kind: 'ego-browser', appVersion: '1.0.0', chromiumVersion: '120.0.0', nodeVersion: '24.0.0', pathReady: true, paired: true } };
    const plans = componentId === 'github-cli' ? github.plans
        : componentId === 'paws-cli' && action ? [{ componentId: 'paws-cli' as const, action, fromVersion: '1.5.0', targetVersion: '1.6.0',
            planFingerprint: 'b'.repeat(64), expiresAt: 1_600_000 }] : undefined;
    return { observations: [ego, paws, base], ...(plans === undefined ? {} : { plans }) };
}

function success(): EnvironmentApplyResponse {
    const before = response().observations[0];
    return { result: { componentId: 'github-cli', status: 'succeeded', before,
        after: { ...before, installedVersion: '2.80.0' }, changed: true } };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('environment RPC contract', () => {
    beforeEach(() => rpc.mockReset());

    it('parses inspect responses and retains the normal machine RPC timeout', async () => {
        rpc.mockResolvedValue(response());
        expect(await inspectMachineEnvironment('air', { componentIds: ['github-cli'] })).toEqual(response());
        expect(rpc).toHaveBeenCalledWith('air', 'environment-inspect-v2', { componentIds: ['github-cli'] });
        rpc.mockResolvedValue({ observations: [{ token: 'unexpected' }] });
        await expect(inspectMachineEnvironment('air', { componentIds: ['github-cli'] })).rejects.toThrow();
    });

    it('falls back to the legacy inspection RPC only when v2 is unavailable', async () => {
        rpc.mockRejectedValueOnce(new Error('RPC method not available')).mockResolvedValueOnce(response());
        await expect(inspectMachineEnvironment('air', { componentIds: ['github-cli'] })).resolves.toEqual(response());
        expect(rpc.mock.calls).toEqual([
            ['air', 'environment-inspect-v2', { componentIds: ['github-cli'] }],
            ['air', 'environment-inspect', { componentIds: ['github-cli'] }],
        ]);

        rpc.mockReset();
        rpc.mockRejectedValueOnce(new Error('network unavailable'));
        await expect(inspectMachineEnvironment('air', { componentIds: ['github-cli'] })).rejects.toThrow('network unavailable');
        expect(rpc).toHaveBeenCalledOnce();
    });

    it('uses the legacy inspection RPC directly for a known pre-v2 daemon', async () => {
        rpc.mockResolvedValue(response());
        await expect(inspectMachineEnvironment('air', { componentIds: ['github-cli'] }, { preferV2: false })).resolves.toEqual(response());
        expect(rpc).toHaveBeenCalledExactlyOnceWith('air', 'environment-inspect', { componentIds: ['github-cli'] });
    });

    it('parses apply responses and selects a ten-minute timeout', async () => {
        const request = { desired: { componentId: 'github-cli' as const, targetVersion: '2.80.0' },
            plan: response('upgrade').plans![0], approvedAt: 1_000_000 };
        rpc.mockResolvedValue(success());
        expect(await applyMachineEnvironment('air', request)).toEqual(success());
        expect(rpc).toHaveBeenCalledWith('air', 'environment-apply', request, { timeoutMs: 600_000 });
        rpc.mockResolvedValue({ result: { status: 'succeeded' } });
        await expect(applyMachineEnvironment('air', request)).rejects.toThrow();
    });
});

describe('useDeviceEnvironment', () => {
    let root: Root;
    let controller: DeviceEnvironmentController;
    let now: number;
    let monotonicTime: number;
    let inspect: ReturnType<typeof vi.fn<DeviceEnvironmentDependencies['inspect']>>;
    let apply: ReturnType<typeof vi.fn<DeviceEnvironmentDependencies['apply']>>;

    function Harness({ machines, onLayout }: { machines: Machine[]; onLayout?: () => void }) {
        controller = useDeviceEnvironment(machines, { inspect, apply, now: () => now, monotonicNow: () => monotonicTime });
        useLayoutEffect(() => { onLayout?.(); }, [onLayout]);
        return null;
    }

    function mount(machines = [machine('air')], onLayout?: () => void) {
        act(() => root.render(createElement(Harness, { machines, onLayout })));
    }

    beforeEach(() => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        root = createRoot(document.createElement('div'));
        now = 1_000_000;
        monotonicTime = 10_000;
        inspect = vi.fn<DeviceEnvironmentDependencies['inspect']>(async (_id, request) => response(request.desired ? 'upgrade' : undefined));
        apply = vi.fn<DeviceEnvironmentDependencies['apply']>(async () => success());
    });

    it('uses the running daemon version when machine metadata is stale after an upgrade', async () => {
        const upgraded = machine('air');
        upgraded.daemonState = { startedWithCliVersion: '1.3.8' };
        rpc.mockReset();
        rpc.mockResolvedValue(response());

        function DefaultHarness() {
            controller = useDeviceEnvironment([upgraded]);
            return null;
        }

        act(() => root.render(createElement(DefaultHarness)));
        await act(async () => controller.scan());

        expect(rpc).toHaveBeenCalledExactlyOnceWith(
            'air', 'environment-inspect-v2', { componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'] },
        );
    });

    it('uses the metadata version when daemon state is stale after an upgrade', async () => {
        const upgraded = machine('air');
        upgraded.metadata = { happyCliVersion: '1.3.8' } as Machine['metadata'];
        upgraded.daemonState = { startedWithCliVersion: '1.3.7' };
        rpc.mockReset();
        rpc.mockResolvedValue(response());

        function DefaultHarness() {
            controller = useDeviceEnvironment([upgraded]);
            return null;
        }

        act(() => root.render(createElement(DefaultHarness)));
        await act(async () => controller.scan());

        expect(rpc).toHaveBeenCalledExactlyOnceWith(
            'air', 'environment-inspect-v2', { componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'] },
        );
    });

    it('probes v2 when synchronized machine version records are missing', async () => {
        const upgraded = machine('air');
        rpc.mockReset();
        rpc.mockResolvedValue(response());

        function DefaultHarness() {
            controller = useDeviceEnvironment([upgraded]);
            return null;
        }

        act(() => root.render(createElement(DefaultHarness)));
        await act(async () => controller.scan());

        expect(rpc).toHaveBeenCalledExactlyOnceWith(
            'air', 'environment-inspect-v2', { componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'] },
        );
    });

    it('probes v2 when both synchronized version records are stale', async () => {
        const upgraded = machine('air');
        upgraded.metadata = { happyCliVersion: '1.3.7' } as Machine['metadata'];
        upgraded.daemonState = { startedWithCliVersion: '1.3.7' };
        rpc.mockReset();
        rpc.mockResolvedValue(response());

        function DefaultHarness() {
            controller = useDeviceEnvironment([upgraded]);
            return null;
        }

        act(() => root.render(createElement(DefaultHarness)));
        await act(async () => controller.scan());

        expect(rpc).toHaveBeenCalledExactlyOnceWith(
            'air', 'environment-inspect-v2', { componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'] },
        );
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.unstubAllGlobals();
    });

    async function prepare() {
        await act(() => controller.scan());
        await act(() => controller.preview());
    }

    it('previews and applies verified Paws peers in a mixed-ownership fleet', async () => {
        inspect.mockImplementation(async (id, request) => {
            const scanned = multiResponse(request.desired ? 'upgrade' : undefined);
            if (id === 'unverified') {
                const paws = scanned.observations.find((entry) => entry.componentId === 'paws-cli')!;
                paws.capability = 'inspect-only';
                paws.source.ownership = 'unverified';
                paws.reasonCode = 'version-source-mismatch';
            }
            return scanned;
        });
        apply.mockImplementation(async () => {
            const before = multiResponse().observations[1];
            return { result: { componentId: 'paws-cli', status: 'succeeded', before,
                after: { ...before, installedVersion: '1.6.0' }, changed: true } };
        });
        mount([machine('verified'), machine('unverified')]);
        await act(() => controller.scan());
        act(() => controller.selectComponent('paws-cli'));
        expect(controller.target).toEqual({ kind: 'ready', targetVersion: '1.6.0' });
        await act(() => controller.preview('paws-cli'));
        await act(() => controller.applyApproved('paws-cli'));
        expect(controller.rows[0].components['paws-cli'].status).toBe('succeeded');
        expect(controller.rows[1].components['paws-cli'].reasonCode).toBe('version-source-mismatch');
        expect(inspect.mock.calls.filter(([, request]) => request.desired).map(([id]) => id)).toEqual(['verified']);
        expect(apply.mock.calls.map(([id]) => id)).toEqual(['verified']);
    });

    it('moves through every phase and sends only the daemon-approved plan', async () => {
        const scan = deferred<EnvironmentInspectResponse>();
        const preview = deferred<EnvironmentInspectResponse>();
        const applied = deferred<EnvironmentApplyResponse>();
        inspect.mockReturnValueOnce(scan.promise).mockReturnValueOnce(preview.promise);
        apply.mockReturnValueOnce(applied.promise);
        mount([machine('air'), machine('offline', false)]);
        expect(controller.phase).toBe('idle');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['pending', 'offline']);
        let operation!: Promise<void>;
        act(() => { operation = controller.scan(); });
        expect(controller.phase).toBe('scanning');
        await act(async () => { scan.resolve(response()); await operation; });
        expect(controller.phase).toBe('scanned');
        act(() => { operation = controller.preview(); });
        expect(controller.phase).toBe('previewing');
        await act(async () => { preview.resolve(response('upgrade')); await operation; });
        expect(controller.phase).toBe('previewed');
        expect(inspect.mock.calls).toEqual([
            ['air', { componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'] }],
            ['air', { componentIds: ['github-cli'], desired: { componentId: 'github-cli', targetVersion: '2.80.0' } }],
        ]);
        act(() => { operation = controller.applyApproved(); });
        expect(controller.phase).toBe('applying');
        await act(async () => { applied.resolve(success()); await operation; });
        expect(controller.phase).toBe('completed');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['succeeded', 'offline']);
        expect(controller.rows[0].components['github-cli'].observation?.installedVersion).toBe('2.80.0');
        expect(apply).toHaveBeenCalledWith('air', { desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
            plan: response('upgrade').plans![0], approvedAt: 1_000_000 });
    });

    it('retains partial inspect and apply failures alongside no-op, repair, and offline rows', async () => {
        inspect.mockImplementation(async (id, request) => {
            if (id === 'broken') throw new Error('disconnected');
            return response(request.desired ? id === 'noop' ? 'none' : id === 'repair' ? 'manual-repair' : 'install' : undefined);
        });
        apply.mockImplementation(async (id) => {
            if (id === 'unknown') throw new Error('operation has timed out');
            return success();
        });
        mount(['ok', 'unknown', 'noop', 'repair', 'broken'].map((id) => machine(id)).concat(machine('offline', false)));
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.phase).toBe('completed');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['succeeded', 'rpc-timeout', 'succeeded', 'manual-repair', 'rpc-error', 'offline']);
        expect(controller.rows[1].components['github-cli']).toMatchObject({ reasonCode: 'rpc-timeout', requiresScan: true });
        expect(apply.mock.calls.map(([id]) => id)).toEqual(['ok', 'unknown', 'noop']);
        await act(() => controller.applyApproved());
        await act(() => controller.preview());
        expect(apply).toHaveBeenCalledTimes(3);
        expect(controller.phase).toBe('completed');
    });

    it('blocks preview and all mutation for a fleet target mismatch', async () => {
        inspect.mockImplementation(async (id) => response(undefined, id === 'air' ? '2.80.0' : '2.81.0'));
        mount([machine('air'), machine('mini')]);
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.target).toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
        expect(controller.phase).toBe('scanned');
        expect(inspect).toHaveBeenCalledTimes(2);
        expect(apply).not.toHaveBeenCalled();
    });

    it('blocks mutation if the source changes during preview, even on a one-machine fleet', async () => {
        inspect.mockResolvedValueOnce(response()).mockResolvedValueOnce(response('upgrade', '2.81.0'));
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.target).toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
        expect(apply).not.toHaveBeenCalled();
    });

    it('suppresses duplicate apply calls within the same render and after completion', async () => {
        const pending = deferred<EnvironmentApplyResponse>();
        apply.mockReturnValue(pending.promise);
        mount();
        await prepare();
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => { first = controller.applyApproved(); second = controller.applyApproved(); });
        expect(apply).toHaveBeenCalledTimes(1);
        await act(async () => { pending.resolve(success()); await Promise.all([first, second]); });
        await act(() => controller.applyApproved());
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it.each(['age', 'expiry'])('requires preview again when plan %s expires', async (kind) => {
        if (kind === 'expiry') {
            const short = response('upgrade');
            short.plans![0].expiresAt = 1_000_001;
            inspect.mockResolvedValueOnce(response()).mockResolvedValueOnce(short);
        }
        mount();
        await prepare();
        now += kind === 'age' ? 600_001 : 1;
        monotonicTime += kind === 'age' ? 600_001 : 1;
        await act(() => controller.applyApproved());
        expect(controller.phase).toBe('scanned');
        expect(controller.rows[0].components['github-cli']).toMatchObject({ reasonCode: 'plan-stale' });
        expect(controller.rows[0].components['github-cli'].plan).toBeUndefined();
        expect(apply).not.toHaveBeenCalled();
    });

    it.each([30_000, -30_000])('accepts a fresh short-lived preview despite client clock skew of %i ms', async (skew) => {
        const short = response('upgrade');
        short.plans![0].expiresAt = 1_000_010;
        inspect.mockResolvedValueOnce(response()).mockResolvedValueOnce(short);
        now += skew;
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.phase).toBe('completed');
        expect(apply).toHaveBeenCalledTimes(1);
        expect(apply.mock.calls[0][1].approvedAt).toBe(1_000_000 + skew);
    });

    it('expires the preview by elapsed time even when the client wall clock moves backwards', async () => {
        mount();
        await prepare();
        now -= 30_000;
        monotonicTime += 600_000;
        await act(() => controller.applyApproved());
        expect(controller.phase).toBe('scanned');
        expect(controller.rows[0].components['github-cli'].reasonCode).toBe('plan-stale');
        expect(apply).not.toHaveBeenCalled();
    });

    it('does not let an older scan overwrite a newer scan', async () => {
        const old = deferred<EnvironmentInspectResponse>();
        inspect.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(undefined, '2.81.0'));
        mount();
        let first!: Promise<void>;
        act(() => { first = controller.scan(); });
        await act(() => controller.scan());
        await act(async () => { old.resolve(response()); await first; });
        expect(controller.target).toEqual({ kind: 'ready', targetVersion: '2.81.0' });
        expect(controller.phase).toBe('scanned');
    });

    it('ignores a late preview after reset and requires a scan before preview', async () => {
        const pending = deferred<EnvironmentInspectResponse>();
        inspect.mockResolvedValueOnce(response()).mockReturnValueOnce(pending.promise);
        mount();
        await act(() => controller.scan());
        let operation!: Promise<void>;
        act(() => { operation = controller.preview(); });
        act(() => controller.reset());
        await act(async () => { pending.resolve(response('upgrade')); await operation; });
        await act(() => controller.preview());
        expect(controller.phase).toBe('idle');
        expect(controller.rows[0].components['github-cli'].plan).toBeUndefined();
    });

    it('ignores old apply results after scan and keeps an in-flight mutation locked across reset', async () => {
        const pending = deferred<EnvironmentApplyResponse>();
        apply.mockReturnValueOnce(pending.promise);
        mount();
        await prepare();
        let old!: Promise<void>;
        act(() => { old = controller.applyApproved(); });
        act(() => controller.reset());
        await prepare();
        await act(() => controller.applyApproved());
        expect(apply).toHaveBeenCalledTimes(1);
        await act(async () => { pending.resolve(success()); await old; });
        expect(controller.phase).toBe('previewed');
        expect(controller.rows[0].components['github-cli'].status).toBe('upgrade');
    });

    it('retains an invalid or missing preview plan as an error without synthesizing mutation', async () => {
        inspect.mockResolvedValue(response());
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.rows[0].components['github-cli'].status).toBe('rpc-error');
        expect(apply).not.toHaveBeenCalled();
    });

    it('invalidates approval on a registry change and keeps newly registered or offline machines visible', async () => {
        mount();
        await prepare();
        const oldApply = controller.applyApproved;
        mount([machine('air', false), machine('new')]);
        await act(() => oldApply());
        expect(controller.phase).toBe('idle');
        expect(controller.rows.map((row) => [row.machineId, row.components['github-cli'].status])).toEqual([['air', 'offline'], ['new', 'pending']]);
        expect(apply).not.toHaveBeenCalled();
        inspect.mockClear();
        await act(() => controller.scan());
        expect(inspect.mock.calls.map(([id]) => id)).toEqual(['new']);
    });

    it.each(['scan', 'preview'] as const)('discards outstanding %s reads after a presence change', async (operation) => {
        mount();
        if (operation === 'preview') await act(() => controller.scan());
        const delayed = deferred<EnvironmentInspectResponse>();
        inspect.mockReturnValueOnce(delayed.promise);
        let pending!: Promise<void>;
        act(() => { pending = controller[operation](); });
        mount([machine('air', false), machine('new')]);
        await act(async () => { delayed.resolve(response('upgrade')); await pending; });
        expect(controller.phase).toBe('idle');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['offline', 'pending']);
        await act(() => controller.applyApproved());
        expect(apply).not.toHaveBeenCalled();
    });

    it.each(['applyApproved', 'preview'] as const)('rejects saved %s before passive registry invalidation', async (operation) => {
        mount();
        await prepare();
        const savedOperation = controller[operation];
        inspect.mockClear();
        let phaseAtLayout: string | undefined;
        let pending!: Promise<void>;
        mount([machine('air'), machine('new')], () => {
            phaseAtLayout = controller.phase;
            pending = savedOperation();
        });
        await act(() => pending);
        expect(phaseAtLayout).toBe('previewed');
        expect(apply).not.toHaveBeenCalled();
        expect(inspect).not.toHaveBeenCalled();
        expect(controller.phase).toBe('idle');
    });

    it('preserves daemon failure, stale, and repair details alongside successful rows', async () => {
        apply.mockImplementation(async (id) => {
            const value = success();
            if (id === 'failed') value.result = { ...value.result, status: 'failed', reasonCode: 'verification-failed' };
            if (id === 'stale') value.result = { ...value.result, status: 'stale-plan', reasonCode: 'plan-stale' };
            if (id === 'repair') value.result = { ...value.result, status: 'manual-repair', reasonCode: 'authentication-missing',
                repairGuide: { channel: 'local-terminal', reasonCode: 'authentication-missing', commands: ['gh auth login'] } };
            return value;
        });
        mount(['ok', 'failed', 'stale', 'repair'].map((id) => machine(id)));
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['succeeded', 'failed', 'stale-plan', 'manual-repair']);
        expect(controller.rows[2].components['github-cli'].requiresScan).toBe(true);
        expect(controller.rows[3].components['github-cli'].result?.repairGuide?.commands).toEqual(['gh auth login']);
    });

    it('treats a structured RPC timeout as unknown rather than a failed installation', async () => {
        const timedOut = success();
        timedOut.result = { ...timedOut.result, status: 'failed', reasonCode: 'rpc-timeout' };
        apply.mockResolvedValue(timedOut);
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.rows[0].components['github-cli']).toMatchObject({ status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true });
    });

    it('preserves a structured local process timeout as a distinct unknown state', async () => {
        const timedOut = success();
        timedOut.result = { ...timedOut.result, status: 'failed', reasonCode: 'process-timeout' };
        apply.mockResolvedValue(timedOut);
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.rows[0].components['github-cli']).toMatchObject({
            status: 'process-timeout', reasonCode: 'process-timeout', requiresScan: true,
            result: { status: 'failed', reasonCode: 'process-timeout' },
        });
    });

    it('publishes each scan row before the slowest settles without enabling an early preview', async () => {
        const slow = deferred<EnvironmentInspectResponse>();
        const fast = deferred<EnvironmentInspectResponse>();
        inspect.mockImplementation((id) => id === 'slow' ? slow.promise : fast.promise);
        mount([machine('slow'), machine('offline', false), machine('fast')]);
        let pending!: Promise<void>;
        act(() => { pending = controller.scan(); });
        await act(async () => { fast.resolve(response()); });
        expect(controller.phase).toBe('scanning');
        expect(controller.rows.map((row) => [row.machineId, row.components['github-cli'].status])).toEqual([
            ['slow', 'pending'], ['offline', 'offline'], ['fast', 'ready'],
        ]);
        expect(controller.target).toEqual({ kind: 'ready', targetVersion: '2.80.0' });
        await act(() => controller.preview());
        expect(inspect).toHaveBeenCalledTimes(2);
        await act(async () => { slow.resolve(response(undefined, '2.81.0')); await pending; });
        expect(controller.phase).toBe('scanned');
        expect(controller.target).toEqual({ kind: 'blocked', reasonCode: 'version-source-mismatch' });
        expect(controller.rows.map((row) => row.machineId)).toEqual(['slow', 'offline', 'fast']);
    });

    it('publishes preview plans independently but waits for all plans before approving', async () => {
        mount([machine('slow'), machine('offline', false), machine('fast')]);
        await act(() => controller.scan());
        const slow = deferred<EnvironmentInspectResponse>();
        const fast = deferred<EnvironmentInspectResponse>();
        inspect.mockImplementation((id) => id === 'slow' ? slow.promise : fast.promise);
        let pending!: Promise<void>;
        act(() => { pending = controller.preview(); });
        await act(async () => { fast.resolve(response('upgrade')); });
        expect(controller.phase).toBe('previewing');
        expect(controller.rows.map((row) => [row.machineId, row.components['github-cli'].status])).toEqual([
            ['slow', 'pending'], ['offline', 'offline'], ['fast', 'upgrade'],
        ]);
        expect(controller.rows[2].components['github-cli'].plan).toEqual(response('upgrade').plans![0]);
        await act(() => controller.applyApproved());
        expect(apply).not.toHaveBeenCalled();
        await act(async () => { slow.reject(new Error('operation has timed out')); await pending; });
        expect(controller.phase).toBe('previewed');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['rpc-timeout', 'offline', 'upgrade']);
        expect(controller.rows[0].components['github-cli'].requiresScan).toBe(true);
    });

    it('publishes each apply result independently and holds the phase and duplicate guard until all settle', async () => {
        mount([machine('slow'), machine('offline', false), machine('fast')]);
        await prepare();
        const slow = deferred<EnvironmentApplyResponse>();
        const fast = deferred<EnvironmentApplyResponse>();
        apply.mockImplementation((id) => id === 'slow' ? slow.promise : fast.promise);
        let pending!: Promise<void>;
        act(() => { pending = controller.applyApproved(); });
        expect(controller.rows[0].components['github-cli']).toMatchObject({
            plan: undefined,
            dispatchedAction: { action: 'upgrade', fromVersion: '2.79.0', targetVersion: '2.80.0' },
        });
        await act(async () => { fast.resolve(success()); });
        expect(controller.phase).toBe('applying');
        expect(controller.rows.map((row) => [row.machineId, row.components['github-cli'].status])).toEqual([
            ['slow', 'upgrade'], ['offline', 'offline'], ['fast', 'succeeded'],
        ]);
        expect(controller.rows[0].components['github-cli']).toMatchObject({
            plan: undefined,
            dispatchedAction: { action: 'upgrade', fromVersion: '2.79.0', targetVersion: '2.80.0' },
        });
        expect(controller.rows[2].components['github-cli'].result?.changed).toBe(true);
        await act(() => controller.applyApproved());
        expect(apply).toHaveBeenCalledTimes(2);
        await act(async () => { slow.reject(new Error('operation has timed out')); await pending; });
        expect(controller.phase).toBe('completed');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['rpc-timeout', 'offline', 'succeeded']);
        expect(controller.rows[0].components['github-cli'].dispatchedAction).toBeUndefined();
        expect(controller.rows[0].components['github-cli']).toMatchObject({ requiresScan: true, reasonCode: 'rpc-timeout' });
    });

    it.each(['success', 'timeout'] as const)('retains settled and outstanding apply rows when a device goes offline: %s', async (settlement) => {
        mount([machine('fast'), machine('slow'), machine('offline', false)]);
        await prepare();
        const slow = deferred<EnvironmentApplyResponse>();
        apply.mockImplementation((id) => id === 'slow' ? slow.promise : Promise.resolve(success()));
        let pending!: Promise<void>;
        await act(async () => { pending = controller.applyApproved(); });
        expect(controller.rows[0].components['github-cli'].status).toBe('succeeded');

        mount([machine('slow', false), machine('new'), machine('fast'), machine('offline', false)]);
        expect(controller.phase).toBe('applying');
        expect(controller.rows.map((row) => [row.machineId, row.components['github-cli'].status])).toEqual([
            ['slow', 'offline'], ['new', 'pending'], ['fast', 'succeeded'], ['offline', 'offline'],
        ]);
        expect(controller.rows.every((row) => row.components['github-cli'].plan === undefined)).toBe(true);
        await act(() => controller.applyApproved());
        await act(() => controller.preview());
        expect(apply).toHaveBeenCalledTimes(2);
        await act(async () => {
            if (settlement === 'success') slow.resolve(success());
            else slow.reject(new Error('operation has timed out'));
            await pending;
        });
        expect(controller.phase).toBe('completed');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['offline', 'pending', 'succeeded', 'offline']);
        expect(controller.rows[0].online).toBe(false);
        if (settlement === 'success') expect(controller.rows[0].components['github-cli'].result?.status).toBe('succeeded');
        else expect(controller.rows[0].components['github-cli'].requiresScan).toBe(true);
        expect(controller.rows[2].components['github-cli'].result?.status).toBe('succeeded');

        mount([machine('fast'), machine('slow'), machine('new'), machine('offline', false)]);
        expect(controller.phase).toBe('completed');
        expect(controller.rows[0].components['github-cli'].status).toBe('succeeded');
        expect(controller.rows[1].components['github-cli'].status).toBe(settlement === 'success' ? 'succeeded' : 'rpc-timeout');
        await act(() => controller.applyApproved());
        expect(apply).toHaveBeenCalledTimes(2);
    });

    it('retains a removed dispatched device until its outstanding result settles', async () => {
        mount([machine('air')]);
        await prepare();
        const pendingResult = deferred<EnvironmentApplyResponse>();
        apply.mockReturnValueOnce(pendingResult.promise);
        let pending!: Promise<void>;
        act(() => { pending = controller.applyApproved(); });
        mount([machine('new')]);
        expect(controller.rows.map((row) => [row.machineId, row.components['github-cli'].status])).toEqual([['new', 'pending'], ['air', 'offline']]);
        await act(async () => { pendingResult.resolve(success()); await pending; });
        expect(controller.phase).toBe('completed');
        expect(controller.rows[1].components['github-cli']).toMatchObject({ status: 'offline', result: { status: 'succeeded' } });
    });

    it.each(['scan', 'preview', 'applyApproved'] as const)('publishes an early %s timeout while another machine is pending', async (operation) => {
        mount([machine('slow'), machine('fast'), machine('offline', false)]);
        if (operation !== 'scan') await act(() => controller.scan());
        if (operation === 'applyApproved') await act(() => controller.preview());
        const slowInspect = deferred<EnvironmentInspectResponse>();
        const fastInspect = deferred<EnvironmentInspectResponse>();
        const slowApply = deferred<EnvironmentApplyResponse>();
        const fastApply = deferred<EnvironmentApplyResponse>();
        inspect.mockImplementation((id) => id === 'slow' ? slowInspect.promise : fastInspect.promise);
        apply.mockImplementation((id) => id === 'slow' ? slowApply.promise : fastApply.promise);
        let pending!: Promise<void>;
        act(() => { pending = controller[operation](); });
        await act(async () => {
            (operation === 'applyApproved' ? fastApply : fastInspect).reject(new Error('operation has timed out'));
        });
        expect(controller.phase).toBe(operation === 'scan' ? 'scanning' : operation === 'preview' ? 'previewing' : 'applying');
        expect(controller.rows[1].components['github-cli']).toMatchObject({ status: 'rpc-timeout', requiresScan: true });
        expect(controller.rows.map((row) => row.machineId)).toEqual(['slow', 'fast', 'offline']);
        await act(async () => {
            if (operation === 'applyApproved') slowApply.resolve(success());
            else slowInspect.resolve(response(operation === 'preview' ? 'upgrade' : undefined));
            await pending;
        });
        expect(controller.phase).toBe(operation === 'scan' ? 'scanned' : operation === 'preview' ? 'previewed' : 'completed');
        expect(controller.rows[1].components['github-cli'].status).toBe('rpc-timeout');
    });

    it.each(['all-none', 'mixed'] as const)('broadcasts the exact approved %s plans and retains unchanged verification', async (mode) => {
        const ids = ['air', 'mini-1', 'mini-2'];
        const plans = ids.map((_, index) => {
            const value = response(mode === 'mixed' && index === 1 ? 'upgrade' : 'none');
            value.plans![0].planFingerprint = String(index + 1).repeat(64);
            return value;
        });
        inspect.mockImplementation(async (id, request) => request.desired ? plans[ids.indexOf(id)] : response());
        apply.mockImplementation(async (_id, request) => {
            const value = success();
            if (request.plan.action === 'none') {
                value.result.before = response('none').observations[0];
                value.result.after = value.result.before;
                value.result.changed = false;
            }
            return value;
        });
        mount(ids.map((id) => machine(id)).concat(machine('offline', false)));
        await prepare();
        expect(apply).not.toHaveBeenCalled();
        await act(() => controller.applyApproved());
        expect(apply.mock.calls).toEqual(ids.map((id, index) => [id, {
            desired: { componentId: 'github-cli', targetVersion: '2.80.0' },
            plan: plans[index].plans![0], approvedAt: 1_000_000,
        }]));
        expect(controller.phase).toBe('completed');
        expect(controller.rows.map((row) => row.components['github-cli'].status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'offline']);
        expect(controller.rows.slice(0, 3).map((row) => row.components['github-cli'].result?.changed))
            .toEqual(mode === 'mixed' ? [false, true, false] : [false, false, false]);
    });
    it('scans all five IDs once per online machine and maps unordered partial observations by identity', async () => {
        inspect.mockResolvedValue(multiResponse());
        mount([machine('air'), machine('offline', false)]);
        await act(() => controller.scan());
        expect(inspect.mock.calls).toEqual([['air', {
            componentIds: ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'],
        }]]);
        const components = controller.rows[0].components;
        expect(components['github-cli'].observation?.installedVersion).toBe('2.79.0');
        expect(components['paws-cli'].observation?.installedVersion).toBe('1.5.0');
        expect(components['ego-browser'].observation?.details).toMatchObject({ paired: true });
        expect(components['cloudflared']).toMatchObject({ status: 'rpc-error', requiresScan: true });
        expect(Object.values(controller.rows[1].components).map((entry) => entry.status))
            .toEqual(['offline', 'offline', 'offline', 'offline', 'offline']);
        expect(controller.targets).toEqual({
            'github-cli': { kind: 'ready', targetVersion: '2.80.0' },
            'paws-cli': { kind: 'ready', targetVersion: '1.6.0' },
            'ego-browser': { kind: 'unavailable' },
            'cloudflare-wrangler': { kind: 'unavailable' },
            cloudflared: { kind: 'unavailable' },
        });
    });

    it('previews and applies Paws only, retaining sibling observations through the operation', async () => {
        inspect.mockImplementation(async (_id, request) => request.desired
            ? { ...multiResponse('upgrade'), observations: [multiResponse().observations[1]] }
            : multiResponse());
        apply.mockImplementation(async (_id, request) => {
            const before = multiResponse().observations[1];
            return { result: { componentId: request.desired.componentId, status: 'succeeded', before,
                after: { ...before, installedVersion: '1.6.0' }, changed: true } };
        });
        mount();
        await act(() => controller.scan());
        const github = controller.rows[0].components['github-cli'].observation;
        const ego = controller.rows[0].components['ego-browser'].observation;
        await act(() => controller.preview('paws-cli'));
        expect(controller.selectedComponent).toBe('paws-cli');
        expect(controller.target).toEqual({ kind: 'ready', targetVersion: '1.6.0' });
        expect(controller.rows[0].components['paws-cli'].plan?.componentId).toBe('paws-cli');
        await act(() => controller.applyApproved('paws-cli'));
        expect(inspect.mock.calls[1][1]).toEqual({ componentIds: ['paws-cli'],
            desired: { componentId: 'paws-cli', targetVersion: '1.6.0' } });
        expect(apply.mock.calls[0][1].desired).toEqual({ componentId: 'paws-cli', targetVersion: '1.6.0' });
        expect(controller.rows[0].components['paws-cli']).toMatchObject({ status: 'succeeded', observation: { installedVersion: '1.6.0' } });
        expect(controller.rows[0].components['github-cli'].observation).toEqual(github);
        expect(controller.rows[0].components['ego-browser'].observation).toEqual(ego);
    });

    it('previews and applies Wrangler authentication through the approved component plan', async () => {
        const base = response().observations[0];
        const before: ComponentObservation = {
            ...base,
            componentId: 'cloudflare-wrangler',
            installedVersion: '4.1.0',
            resolvedExecutable: '/opt/npm/bin/wrangler',
            source: { kind: 'npm-global', available: true, latestVersion: '4.1.0', ownership: 'verified' },
            capability: 'alignable',
            details: { kind: 'cloudflare-wrangler' },
            authentication: { provider: 'cloudflare', status: 'missing' },
            reasonCode: 'authentication-missing',
        };
        const authenticationPlan: ComponentPlan = {
            componentId: 'cloudflare-wrangler', action: 'authenticate', fromVersion: '4.1.0', targetVersion: '4.1.0',
            planFingerprint: 'c'.repeat(64), expiresAt: 1_600_000,
        };
        inspect.mockImplementation(async (_id, request) => request.desired
            ? { observations: [before], plans: [authenticationPlan] }
            : { observations: [before] });
        apply.mockResolvedValue({ result: {
            componentId: 'cloudflare-wrangler', status: 'succeeded', before,
            after: { ...before, authentication: { provider: 'cloudflare', status: 'authenticated' }, reasonCode: undefined },
            changed: true,
        } });

        mount();
        await act(() => controller.scan());
        act(() => controller.selectComponent('cloudflare-wrangler'));
        await act(() => controller.preview('cloudflare-wrangler'));
        expect(controller.rows[0].components['cloudflare-wrangler']).toMatchObject({ status: 'authenticate', plan: authenticationPlan });
        await act(() => controller.applyApproved('cloudflare-wrangler'));

        expect(apply.mock.calls[0][1]).toEqual({
            desired: { componentId: 'cloudflare-wrangler', targetVersion: '4.1.0' },
            plan: authenticationPlan,
            approvedAt: 1_000_000,
        });
        expect(controller.rows[0].components['cloudflare-wrangler']).toMatchObject({
            status: 'succeeded', observation: { authentication: { status: 'authenticated' } },
        });
    });

    it.each(['ego-browser', 'cloudflare-wrangler', 'cloudflared'] as const)('keeps %s selected but does not call RPC without an alignable target', async (componentId) => {
        inspect.mockResolvedValue(multiResponse());
        mount();
        await act(() => controller.scan());
        inspect.mockClear();
        act(() => controller.selectComponent(componentId));
        await act(() => controller.preview(componentId));
        await act(() => controller.applyApproved(componentId));
        expect(controller.selectedComponent).toBe(componentId);
        expect(inspect).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
        expect(controller.phase).toBe('scanned');
    });

    it('rejects saved approval after selecting another component and preserves sibling results', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined, request.desired?.componentId));
        mount();
        await act(() => controller.scan());
        await act(() => controller.preview('paws-cli'));
        const oldApply = controller.applyApproved;
        act(() => controller.selectComponent('github-cli'));
        await act(() => oldApply('paws-cli'));
        expect(apply).not.toHaveBeenCalled();
        expect(controller.rows[0].components['paws-cli'].plan).toBeUndefined();
        expect(controller.phase).toBe('scanned');
    });

    it('isolates a missing selected preview plan and a failed preview RPC from sibling observations', async () => {
        inspect.mockResolvedValueOnce(multiResponse()).mockResolvedValueOnce(multiResponse());
        mount();
        await act(() => controller.scan());
        const siblings = controller.rows[0].components;
        await act(() => controller.preview('paws-cli'));
        expect(controller.rows[0].components['paws-cli'].status).toBe('rpc-error');
        expect(controller.rows[0].components['github-cli']).toEqual(siblings['github-cli']);
        expect(controller.rows[0].components['ego-browser']).toEqual(siblings['ego-browser']);
        inspect.mockRejectedValueOnce(new Error('timeout'));
        await act(() => controller.preview('github-cli'));
        expect(controller.rows[0].components['github-cli'].status).toBe('rpc-timeout');
        expect(controller.rows[0].components['ego-browser']).toEqual(siblings['ego-browser']);
    });

    it('retains Paws dispatched results and all sibling observations across registry changes', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined));
        const pending = deferred<EnvironmentApplyResponse>();
        apply.mockReturnValueOnce(pending.promise);
        mount();
        await act(() => controller.scan());
        await act(() => controller.preview('paws-cli'));
        const siblings = controller.rows[0].components;
        let operation!: Promise<void>;
        act(() => { operation = controller.applyApproved(); });
        mount([machine('air', false), machine('new')]);
        expect(controller.rows[0].components['paws-cli'].dispatchedAction?.targetVersion).toBe('1.6.0');
        const before = multiResponse().observations[1];
        await act(async () => {
            pending.resolve({ result: { componentId: 'paws-cli', status: 'succeeded', before,
                after: { ...before, installedVersion: '1.6.0' }, changed: true } });
            await operation;
        });
        expect(controller.rows[0].components['paws-cli']).toMatchObject({ status: 'offline', result: { status: 'succeeded' } });
        expect(controller.rows[0].components['github-cli'].observation).toEqual(siblings['github-cli'].observation);
        expect(controller.rows[0].components['ego-browser'].observation).toEqual(siblings['ego-browser'].observation);
        mount([machine('air'), machine('new')]);
        expect(controller.rows[0].components['paws-cli'].status).toBe('succeeded');
        expect(controller.rows[0].components['github-cli'].status).toBe('ready');
    });

    it('retains completed results when a sibling preview is invalidated by registry changes', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined, request.desired?.componentId));
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        await act(() => controller.preview('paws-cli'));
        mount([machine('air', false), machine('new')]);
        expect(controller.rows[0].components['github-cli'].result?.status).toBe('succeeded');
        expect(controller.rows[0].components['paws-cli'].plan).toBeUndefined();
        expect(controller.phase).toBe('idle');
        mount([machine('air'), machine('new')]);
        expect(controller.rows[0].components['github-cli'].status).toBe('succeeded');
        await act(() => controller.applyApproved('paws-cli'));
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('rejects a Paws approval when executable ownership is unverified even if a daemon returns an install plan', async () => {
        inspect.mockImplementation(async (_id, request) => {
            const value = multiResponse(request.desired ? 'upgrade' : undefined);
            value.observations[1].source.ownership = 'unverified';
            return value;
        });
        mount();
        await act(() => controller.scan());
        await act(() => controller.preview('paws-cli'));
        await act(() => controller.applyApproved('paws-cli'));
        expect(apply).not.toHaveBeenCalled();
        expect(controller.rows[0].components['github-cli'].observation).toBeDefined();
    });

    it('does not attach a mismatched apply response to the approved component', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined));
        mount();
        await act(() => controller.scan());
        await act(() => controller.preview('paws-cli'));
        await act(() => controller.applyApproved());
        expect(controller.rows[0].components['paws-cli']).toMatchObject({ status: 'rpc-error', requiresScan: true });
        expect(controller.rows[0].components['paws-cli'].observation?.componentId).toBe('paws-cli');
        expect(controller.rows[0].components['paws-cli'].result).toBeUndefined();
        expect(controller.rows[0].components['github-cli'].observation?.componentId).toBe('github-cli');
    });

    it('requires a fresh scan before sibling preview after completed results survive a registry change', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined, request.desired?.componentId));
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        mount([machine('air'), machine('new')]);
        inspect.mockClear();
        await act(() => controller.preview('paws-cli'));
        act(() => controller.selectComponent('paws-cli'));
        await act(() => controller.preview());
        expect(inspect).not.toHaveBeenCalled();
        expect(controller.targets['paws-cli']).toEqual({ kind: 'unavailable' });
        expect(controller.rows[0].components['github-cli'].result?.status).toBe('succeeded');
    });

    it.each([false, true])('preserves newer sibling repair state when registry reconciliation retains a completed apply (prior Paws result: %s)', async (priorPawsResult) => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined, request.desired?.componentId));
        apply.mockImplementation(async (_id, request) => {
            const before = request.desired.componentId === 'paws-cli' ? multiResponse().observations[1] : response().observations[0];
            return { result: { componentId: request.desired.componentId, status: 'succeeded', before,
                after: { ...before, installedVersion: request.desired.targetVersion }, changed: true } };
        });
        mount();
        await act(() => controller.scan());
        if (priorPawsResult) {
            await act(() => controller.preview('paws-cli'));
            await act(() => controller.applyApproved());
            expect(controller.rows[0].components['paws-cli'].result?.after.installedVersion).toBe('1.6.0');
        }
        await act(() => controller.preview('github-cli'));
        await act(() => controller.applyApproved());
        const repair = multiResponse('manual-repair');
        repair.observations[1].installedVersion = '1.6.1';
        repair.observations[1].reasonCode = 'version-ahead';
        repair.plans![0].reasonCode = 'version-ahead';
        inspect.mockResolvedValueOnce(repair);
        await act(() => controller.preview('paws-cli'));
        mount([machine('air'), machine('new')]);
        expect(controller.rows[0].components['github-cli'].result?.status).toBe('succeeded');
        expect(controller.rows[0].components['paws-cli']).toMatchObject({
            status: 'manual-repair', reasonCode: 'version-ahead', observation: { installedVersion: '1.6.1' },
        });
        if (priorPawsResult) expect(controller.rows[0].components['paws-cli'].result).toMatchObject({
            status: 'succeeded', after: { installedVersion: '1.6.0' },
        });
        expect(controller.rows[0].components['paws-cli'].plan).toBeUndefined();
        mount([machine('air', false), machine('new')]);
        mount([machine('air'), machine('new')]);
        expect(controller.rows[0].components['paws-cli']).toMatchObject({
            status: 'manual-repair', reasonCode: 'version-ahead', observation: { installedVersion: '1.6.1' },
        });
    });

    it('requires scanning a timed-out component even after selecting a sibling and switching back', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined, request.desired?.componentId));
        apply.mockRejectedValueOnce(new Error('RPC timeout'));
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.rows[0].components['github-cli'].requiresScan).toBe(true);
        act(() => controller.selectComponent('paws-cli'));
        act(() => controller.selectComponent('github-cli'));
        inspect.mockClear();
        await act(() => controller.preview());
        await act(() => controller.applyApproved());
        expect(inspect).not.toHaveBeenCalled();
        expect(apply).toHaveBeenCalledTimes(1);
        expect(controller.rows[0].components['github-cli']).toMatchObject({ status: 'rpc-timeout', requiresScan: true });
        await act(() => controller.preview('paws-cli'));
        expect(controller.rows[0].components['paws-cli'].plan?.componentId).toBe('paws-cli');
        expect(controller.rows[0].components['github-cli'].requiresScan).toBe(true);
        await act(() => controller.scan());
        await act(() => controller.preview('github-cli'));
        await act(() => controller.applyApproved());
        expect(apply).toHaveBeenCalledTimes(2);
    });

    it('binds a saved no-argument approval to its original component and preview', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined, request.desired?.componentId));
        mount();
        await prepare();
        const approveGithub = controller.applyApproved;
        await act(() => controller.preview('paws-cli'));
        await act(() => approveGithub());
        expect(apply).not.toHaveBeenCalled();
        expect(controller.selectedComponent).toBe('paws-cli');
        expect(controller.phase).toBe('previewed');
        await act(() => controller.preview('github-cli'));
        await act(() => approveGithub());
        expect(apply).not.toHaveBeenCalled();
        await act(() => controller.applyApproved());
        expect(apply).toHaveBeenCalledTimes(1);
    });

    it('retains a sibling manual-repair preview when another component already has an apply result', async () => {
        inspect.mockImplementation(async (_id, request) => multiResponse(request.desired ? 'upgrade' : undefined, request.desired?.componentId));
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        inspect.mockResolvedValueOnce(multiResponse('manual-repair'));
        await act(() => controller.preview('paws-cli'));
        await act(() => controller.applyApproved());
        expect(controller.rows[0].components['paws-cli'].status).toBe('manual-repair');
        expect(controller.rows[0].components['github-cli'].result?.status).toBe('succeeded');
        expect(apply).toHaveBeenCalledTimes(1);
    });

});
