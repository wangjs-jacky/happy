// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentPlan, EnvironmentInspectResponse, EnvironmentApplyResponse } from '@slopus/happy-wire';
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
            packageManager: { kind: 'homebrew', available: true, stableVersion: version },
            authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: 1_000_000 }],
        ...(action ? { plans: [{ componentId: 'github-cli', action, fromVersion: installedVersion, targetVersion: version,
            planFingerprint: 'a'.repeat(64), expiresAt: 1_600_000,
            ...(action === 'manual-repair' ? { reasonCode: 'authentication-missing' as const } : {}) }] } : {}),
    };
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
        expect(rpc).toHaveBeenCalledWith('air', 'environment-inspect', { componentIds: ['github-cli'] });
        rpc.mockResolvedValue({ observations: [{ token: 'unexpected' }] });
        await expect(inspectMachineEnvironment('air', { componentIds: ['github-cli'] })).rejects.toThrow();
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
    let inspect: ReturnType<typeof vi.fn<DeviceEnvironmentDependencies['inspect']>>;
    let apply: ReturnType<typeof vi.fn<DeviceEnvironmentDependencies['apply']>>;

    function Harness({ machines, onLayout }: { machines: Machine[]; onLayout?: () => void }) {
        controller = useDeviceEnvironment(machines, { inspect, apply, now: () => now });
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
        inspect = vi.fn<DeviceEnvironmentDependencies['inspect']>(async (_id, request) => response(request.desired ? 'upgrade' : undefined));
        apply = vi.fn<DeviceEnvironmentDependencies['apply']>(async () => success());
    });

    afterEach(() => {
        act(() => root.unmount());
        vi.unstubAllGlobals();
    });

    async function prepare() {
        await act(() => controller.scan());
        await act(() => controller.preview());
    }

    it('moves through every phase and sends only the daemon-approved plan', async () => {
        const scan = deferred<EnvironmentInspectResponse>();
        const preview = deferred<EnvironmentInspectResponse>();
        const applied = deferred<EnvironmentApplyResponse>();
        inspect.mockReturnValueOnce(scan.promise).mockReturnValueOnce(preview.promise);
        apply.mockReturnValueOnce(applied.promise);
        mount([machine('air'), machine('offline', false)]);
        expect(controller.phase).toBe('idle');
        expect(controller.rows.map((row) => row.status)).toEqual(['pending', 'offline']);
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
            ['air', { componentIds: ['github-cli'] }],
            ['air', { componentIds: ['github-cli'], desired: { componentId: 'github-cli', targetVersion: '2.80.0' } }],
        ]);
        act(() => { operation = controller.applyApproved(); });
        expect(controller.phase).toBe('applying');
        await act(async () => { applied.resolve(success()); await operation; });
        expect(controller.phase).toBe('completed');
        expect(controller.rows.map((row) => row.status)).toEqual(['succeeded', 'offline']);
        expect(controller.rows[0].observation?.installedVersion).toBe('2.80.0');
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
        expect(controller.rows.map((row) => row.status)).toEqual(['succeeded', 'rpc-timeout', 'succeeded', 'manual-repair', 'rpc-error', 'offline']);
        expect(controller.rows[1]).toMatchObject({ reasonCode: 'rpc-timeout', requiresScan: true });
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
        await act(() => controller.applyApproved());
        expect(controller.phase).toBe('scanned');
        expect(controller.rows[0]).toMatchObject({ reasonCode: 'plan-stale' });
        expect(controller.rows[0].plan).toBeUndefined();
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
        expect(controller.rows[0].plan).toBeUndefined();
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
        expect(controller.rows[0].status).toBe('upgrade');
    });

    it('retains an invalid or missing preview plan as an error without synthesizing mutation', async () => {
        inspect.mockResolvedValue(response());
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.rows[0].status).toBe('rpc-error');
        expect(apply).not.toHaveBeenCalled();
    });

    it('invalidates approval on a registry change and keeps newly registered or offline machines visible', async () => {
        mount();
        await prepare();
        const oldApply = controller.applyApproved;
        mount([machine('air', false), machine('new')]);
        await act(() => oldApply());
        expect(controller.phase).toBe('idle');
        expect(controller.rows.map((row) => [row.machineId, row.status])).toEqual([['air', 'offline'], ['new', 'pending']]);
        expect(apply).not.toHaveBeenCalled();
        inspect.mockClear();
        await act(() => controller.scan());
        expect(inspect.mock.calls.map(([id]) => id)).toEqual(['new']);
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
        expect(controller.rows.map((row) => row.status)).toEqual(['succeeded', 'failed', 'stale-plan', 'manual-repair']);
        expect(controller.rows[2].requiresScan).toBe(true);
        expect(controller.rows[3].result?.repairGuide?.commands).toEqual(['gh auth login']);
    });

    it('treats a structured RPC timeout as unknown rather than a failed installation', async () => {
        const timedOut = success();
        timedOut.result = { ...timedOut.result, status: 'failed', reasonCode: 'rpc-timeout' };
        apply.mockResolvedValue(timedOut);
        mount();
        await prepare();
        await act(() => controller.applyApproved());
        expect(controller.rows[0]).toMatchObject({ status: 'rpc-timeout', reasonCode: 'rpc-timeout', requiresScan: true });
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
        expect(controller.rows.map((row) => [row.machineId, row.status])).toEqual([
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
        expect(controller.rows.map((row) => [row.machineId, row.status])).toEqual([
            ['slow', 'pending'], ['offline', 'offline'], ['fast', 'upgrade'],
        ]);
        expect(controller.rows[2].plan).toEqual(response('upgrade').plans![0]);
        await act(() => controller.applyApproved());
        expect(apply).not.toHaveBeenCalled();
        await act(async () => { slow.reject(new Error('operation has timed out')); await pending; });
        expect(controller.phase).toBe('previewed');
        expect(controller.rows.map((row) => row.status)).toEqual(['rpc-timeout', 'offline', 'upgrade']);
        expect(controller.rows[0].requiresScan).toBe(true);
    });

    it('publishes each apply result independently and holds the phase and duplicate guard until all settle', async () => {
        mount([machine('slow'), machine('offline', false), machine('fast')]);
        await prepare();
        const slow = deferred<EnvironmentApplyResponse>();
        const fast = deferred<EnvironmentApplyResponse>();
        apply.mockImplementation((id) => id === 'slow' ? slow.promise : fast.promise);
        let pending!: Promise<void>;
        act(() => { pending = controller.applyApproved(); });
        await act(async () => { fast.resolve(success()); });
        expect(controller.phase).toBe('applying');
        expect(controller.rows.map((row) => [row.machineId, row.status])).toEqual([
            ['slow', 'upgrade'], ['offline', 'offline'], ['fast', 'succeeded'],
        ]);
        expect(controller.rows[2].result?.changed).toBe(true);
        await act(() => controller.applyApproved());
        expect(apply).toHaveBeenCalledTimes(2);
        await act(async () => { slow.reject(new Error('operation has timed out')); await pending; });
        expect(controller.phase).toBe('completed');
        expect(controller.rows.map((row) => row.status)).toEqual(['rpc-timeout', 'offline', 'succeeded']);
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
        expect(controller.rows[1]).toMatchObject({ machineId: 'fast', status: 'rpc-timeout', requiresScan: true });
        expect(controller.rows.map((row) => row.machineId)).toEqual(['slow', 'fast', 'offline']);
        await act(async () => {
            if (operation === 'applyApproved') slowApply.resolve(success());
            else slowInspect.resolve(response(operation === 'preview' ? 'upgrade' : undefined));
            await pending;
        });
        expect(controller.phase).toBe(operation === 'scan' ? 'scanned' : operation === 'preview' ? 'previewed' : 'completed');
        expect(controller.rows[1].status).toBe('rpc-timeout');
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
        expect(controller.rows.map((row) => row.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'offline']);
        expect(controller.rows.slice(0, 3).map((row) => row.result?.changed))
            .toEqual(mode === 'mixed' ? [false, true, false] : [false, false, false]);
    });
});
