import { describe, expect, it, vi } from 'vitest';
import type { ComponentObservation, EnvironmentComponentId, EnvironmentInspectRequest } from '@slopus/happy-wire';
import type { Machine } from '@/sync/storageTypes';
import { createEnvironmentDashboard, describeEnvironmentCell } from './environmentDashboard';

const ids: EnvironmentComponentId[] = ['github-cli', 'paws-cli', 'ego-browser', 'cloudflare-wrangler', 'cloudflared'];
function machine(id: string, active = true): Machine {
    return { id, active, activeAt: 1, createdAt: 1, updatedAt: 1, seq: 1, metadata: null, metadataVersion: 1, daemonState: null, daemonStateVersion: 1 };
}
function observation(componentId: EnvironmentComponentId, version = '1.0.0', target = '1.1.0'): ComponentObservation {
    return { componentId, platform: 'darwin', architecture: 'arm64', support: 'supported', installed: true,
        installedVersion: version, resolvedExecutable: '/verified/tool', capability: 'alignable', inspectedAt: 1,
        source: { kind: 'npm-global', available: true, latestVersion: target, ownership: 'verified' },
        authentication: { provider: componentId === 'github-cli' ? 'github.com' : 'cloudflare', status: 'authenticated' },
        details: componentId === 'ego-browser' ? { kind: componentId, appVersion: version, paired: true, pathReady: true, chromiumVersion: null, nodeVersion: null }
            : componentId === 'cloudflared' ? { kind: componentId, tunnelCertificatePresent: true } : { kind: componentId },
    } as ComponentObservation;
}
function fixture() {
    let fleet = [machine('a'), machine('b')];
    let active = true;
    let ready = true;
    const observations = new Map(fleet.map(m => [m.id, ids.map(id => observation(id))]));
    const inspect = vi.fn(async (id: string, request: EnvironmentInspectRequest) => {
        const found = observations.get(id)!.filter(o => request.componentIds.includes(o.componentId));
        return { observations: found, ...(request.desired ? { plans: [{ componentId: request.desired.componentId,
            action: 'upgrade' as const, fromVersion: found[0].installedVersion, targetVersion: request.desired.targetVersion,
            planFingerprint: 'a'.repeat(64), expiresAt: Date.now() + 600_000 }] } : {}) };
    });
    const apply = vi.fn(async (id: string, request: any) => {
        const row = observations.get(id)!;
        const before = row.find(o => o.componentId === request.desired.componentId)!;
        const after = { ...before, installedVersion: request.desired.targetVersion };
        observations.set(id, row.map(o => o.componentId === before.componentId ? after : o));
        return { result: { componentId: before.componentId, status: 'succeeded' as const, before, after, changed: true } };
    });
    const store = createEnvironmentDashboard({ inspect, apply, machines: () => fleet, active: () => active, ready: () => ready, now: Date.now });
    store.setMachines(fleet);
    return { store, inspect, apply, observations, setReady: (value: boolean) => { ready = value; }, setFleet: (value: Machine[]) => { fleet = value; store.setMachines(fleet); }, invalidate: () => { active = false; } };
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };

describe('environment dashboard task scope', () => {
    it('keeps cached results but does not scan or dispatch while the transport is disconnected', async () => {
        const f = fixture(); await f.store.scan();
        const checked = f.store.getSnapshot().lastChecked;
        f.inspect.mockClear(); f.setReady(false);
        await f.store.scan(); await f.store.update({}); await f.store.runSingle('a', 'github-cli');
        expect(f.inspect).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
        expect(f.store.getCandidates()).toEqual([]);
        expect(f.store.getSnapshot().lastChecked).toBe(checked);
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].observation?.installedVersion).toBe('1.0.0');
    });
    it('blocks every mutation on an unresolved machine across clicks and ordinary scans', async () => {
        const f = fixture(); await f.store.scan(); f.apply.mockRejectedValueOnce(new Error('Connection lost'));
        await f.store.runSingle('a', 'github-cli');
        expect(f.store.getCandidates({ machineId: 'a' })).toEqual([]);
        await f.store.scan();
        await f.store.runSingle('a', 'paws-cli');
        expect(f.apply).toHaveBeenCalledTimes(1);
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].phase).toBe('uncertain');
        expect(f.store.getCandidates({ machineId: 'b' }).length).toBeGreaterThan(0);
    });
    it('clears stale success details on a new inspection', async () => {
        const f = fixture(); await f.store.scan(); await f.store.runSingle('a', 'github-cli');
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].result).toBeDefined();
        await f.store.scan();
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].result).toBeUndefined();
    });
    it('only unlocks after explicit confirmation of remote completion, then inspects without retrying', async () => {
        const f = fixture(); await f.store.scan(); f.apply.mockRejectedValueOnce(new Error('Connection lost'));
        await f.store.runSingle('a', 'github-cli');
        await f.store.confirmStopped('a');
        expect(f.store.getSnapshot().rows[0].unresolved).toBe(false);
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].phase).toBe('idle');
        expect(f.apply).toHaveBeenCalledTimes(1);
    });
    it('queues a rescan when a machine reconnects during inspection', async () => {
        const f = fixture(); await f.store.scan();
        f.setFleet([machine('a'), machine('b', false)]);
        const gate = deferred();
        f.inspect.mockImplementationOnce(async () => { await gate.promise; return { observations: [observation('github-cli')] }; });
        const scan = f.store.scan();
        f.setFleet([machine('a'), machine('b')]);
        expect(f.store.getSnapshot().rows[1].cells['github-cli'].phase).toBe('unknown');
        void f.store.scan(); gate.resolve(); await scan;
        expect(f.inspect.mock.calls.filter(([id]) => id === 'b')).toHaveLength(2);
        expect(f.store.getSnapshot().rows[1].cells['github-cli'].phase).toBe('idle');
    });
    it('scans all components without clearing prior observations or performing writes', async () => {
        const f = fixture(); await f.store.scan();
        const gate = deferred(); f.inspect.mockImplementationOnce(async () => { await gate.promise; return { observations: [] }; });
        const scanning = f.store.scan();
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].observation?.installedVersion).toBe('1.0.0');
        expect(f.apply).not.toHaveBeenCalled(); gate.resolve(); await scanning;
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].phase).toBe('unknown');
    });
    it('uses each machine source and only the selected tool', async () => {
        const f = fixture(); f.observations.get('b')![0].source.latestVersion = '1.2.0';
        await f.store.scan(); await f.store.update({ componentId: 'github-cli' });
        expect(f.apply.mock.calls.map(([id, request]) => [id, request.desired.targetVersion])).toEqual([['a', '1.1.0'], ['b', '1.2.0']]);
        expect(f.store.getSnapshot().batch).toMatchObject({ succeeded: 2, failed: 0, uncertain: 0 });
    });
    it('executes a single selected cell', async () => {
        const f = fixture(); await f.store.scan(); await f.store.update({ machineId: 'b', componentId: 'paws-cli' });
        expect(f.apply).toHaveBeenCalledTimes(1); expect(f.apply.mock.calls[0][0]).toBe('b');
        expect(f.apply.mock.calls[0][1].desired.componentId).toBe('paws-cli');
    });
    it('runs devices concurrently, serializes each device and ignores double clicks', async () => {
        const f = fixture(); await f.store.scan(); const gates = [deferred(), deferred()];
        f.apply.mockImplementationOnce(async (...args) => { await gates[0].promise; return { result: { componentId: 'github-cli', status: 'succeeded', before: observation('github-cli'), after: observation('github-cli', '1.1.0'), changed: true } }; });
        f.apply.mockImplementationOnce(async () => { await gates[1].promise; return { result: { componentId: 'github-cli', status: 'succeeded', before: observation('github-cli'), after: observation('github-cli', '1.1.0'), changed: true } }; });
        const task = f.store.update({}); await vi.waitFor(() => expect(f.apply).toHaveBeenCalledTimes(2));
        await f.store.update({}); expect(f.apply).toHaveBeenCalledTimes(2);
        expect(new Set(f.apply.mock.calls.map(([id]) => id)).size).toBe(2);
        gates[0].resolve(); gates[1].resolve(); await task;
        expect(f.apply.mock.calls.map(([id, req]) => `${id}:${req.desired.componentId}`)).toHaveLength(8);
    });
    it('skips offline peers and does not batch login or repair', async () => {
        const f = fixture(); f.setFleet([machine('a'), machine('b', false)]);
        const wrangler = observation('cloudflare-wrangler', '1.1.0'); wrangler.authentication!.status = 'missing';
        f.observations.get('a')![3] = wrangler;
        await f.store.scan(); await f.store.update({});
        expect(f.apply.mock.calls.every(([id]) => id === 'a')).toBe(true);
        expect(f.apply.mock.calls.some(([, req]) => req.desired.componentId === 'cloudflare-wrangler')).toBe(false);
    });
    it.each(['target', 'from', 'action'] as const)('does not execute a changed %s during preflight', async kind => {
        const f = fixture(); await f.store.scan();
        f.inspect.mockImplementationOnce(async () => ({ observations: [observation('github-cli', kind === 'from' ? '0.9.0' : '1.0.0', kind === 'target' ? '1.2.0' : '1.1.0')], plans: [{
            componentId: 'github-cli', action: (kind === 'action' ? 'authenticate' : 'upgrade') as 'upgrade',
            fromVersion: kind === 'from' ? '0.9.0' : '1.0.0', targetVersion: '1.1.0', planFingerprint: 'a'.repeat(64), expiresAt: Date.now() + 600_000,
        }] }));
        await f.store.update({ machineId: 'a', componentId: 'github-cli' });
        expect(f.apply).not.toHaveBeenCalled(); expect(f.store.getSnapshot().rows[0].cells['github-cli'].phase).toBe('changed');
    });
    it.each(['ownership', 'executable', 'source', 'support'] as const)('rejects changed %s before applying', async kind => {
        const f = fixture(); await f.store.scan();
        const changed = observation('github-cli');
        if (kind === 'ownership') changed.source.ownership = 'unverified';
        if (kind === 'executable') changed.resolvedExecutable = '/another/tool';
        if (kind === 'source') changed.source.kind = 'homebrew';
        if (kind === 'support') changed.support = 'unsupported';
        f.inspect.mockResolvedValueOnce({ observations: [changed], plans: [{ componentId: 'github-cli', action: 'upgrade',
            fromVersion: '1.0.0', targetVersion: '1.1.0', planFingerprint: 'a'.repeat(64), expiresAt: Date.now() + 600_000 }] });
        await f.store.update({ machineId: 'a', componentId: 'github-cli' });
        expect(f.apply).not.toHaveBeenCalled();
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].phase).toBe('changed');
    });
    it.each(['component', 'version'] as const)('does not claim success when the apply readback has the wrong %s', async kind => {
        const f = fixture(); await f.store.scan();
        f.apply.mockResolvedValueOnce({ result: { componentId: 'github-cli', status: 'succeeded', before: observation('github-cli'),
            after: observation(kind === 'component' ? 'paws-cli' : 'github-cli', kind === 'version' ? '1.0.0' : '1.1.0'), changed: true } });
        await f.store.update({ machineId: 'a', componentId: 'github-cli' });
        expect(f.store.getSnapshot().batch).toMatchObject({ succeeded: 0, uncertain: 1 });
        expect(f.store.getSnapshot().rows[0].unresolved).toBe(true);
        expect(f.store.getCandidates({ machineId: 'a' })).toEqual([]);
    });
    it('stops the uncertain machine queue and never blindly retries an unknown mutation', async () => {
        const f = fixture(); await f.store.scan(); f.apply.mockRejectedValueOnce(new Error('RPC timed out'));
        await f.store.update({});
        expect(f.apply.mock.calls.filter(([id]) => id === 'a')).toHaveLength(1);
        expect(f.store.getSnapshot().batch?.uncertain).toBe(1);
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].phase).toBe('uncertain');
        const calls = f.apply.mock.calls.length; await f.store.update({ machineId: 'a', componentId: 'github-cli' });
        expect(f.apply).toHaveBeenCalledTimes(calls);
    });
    it('blocks the whole machine when the daemon reports an already running installer', async () => {
        const f = fixture(); await f.store.scan();
        f.apply.mockResolvedValueOnce({ result: { componentId: 'github-cli', status: 'failed',
            before: observation('github-cli'), after: observation('github-cli'), changed: false,
            reasonCode: 'operation-in-progress' } } as any);
        await f.store.update({});
        expect(f.apply.mock.calls.filter(([id]) => id === 'a')).toHaveLength(1);
        expect(f.store.getSnapshot().rows[0].unresolved).toBe(true);
        expect(f.store.getSnapshot().rows[0].cells['github-cli'].phase).toBe('uncertain');
        expect(f.store.getCandidates({ machineId: 'a' })).toEqual([]);
        expect(f.store.getSnapshot().batch).toMatchObject({ uncertain: 1, skipped: 3, succeeded: 4 });
    });
    it('continues independent work after a verified failed update and permits targeted retry', async () => {
        const f = fixture(); await f.store.scan(); f.apply.mockResolvedValueOnce({ result: { componentId: 'github-cli', status: 'failed' as 'succeeded', before: observation('github-cli'), after: observation('github-cli'), changed: false, reasonCode: 'install-failed' } } as any);
        await f.store.update({}); expect(f.store.getSnapshot().batch?.failed).toBe(1);
        await f.store.update({ machineId: 'a', componentId: 'github-cli' });
        expect(f.store.getSnapshot().batch?.succeeded).toBe(1);
    });
    it('retains work without subscribers and cancels queued dispatch when auth changes', async () => {
        const f = fixture(); await f.store.scan(); const gate = deferred();
        f.inspect.mockImplementationOnce(async () => { await gate.promise; return { observations: [observation('github-cli')], plans: [{componentId:'github-cli',action:'upgrade',fromVersion:'1.0.0',targetVersion:'1.1.0',planFingerprint:'a'.repeat(64),expiresAt:Date.now()+10000}] }; });
        const unsubscribe = f.store.subscribe(() => {}); const task = f.store.update({ machineId: 'a' }); unsubscribe();
        expect(f.store.getSnapshot().running).toBe(true); f.invalidate(); gate.resolve(); await task;
        expect(f.apply).not.toHaveBeenCalled();
    });
    it('rechecks current connectivity before dispatch', async () => {
        const f = fixture(); await f.store.scan(); const gate = deferred();
        f.inspect.mockImplementationOnce(async () => { await gate.promise; return { observations: [observation('github-cli')], plans: [{componentId:'github-cli',action:'upgrade',fromVersion:'1.0.0',targetVersion:'1.1.0',planFingerprint:'a'.repeat(64),expiresAt:Date.now()+10000}] }; });
        const task=f.store.update({ machineId:'a', componentId:'github-cli' }); f.setFleet([machine('a',false),machine('b')]); gate.resolve(); await task;
        expect(f.apply).not.toHaveBeenCalled();
    });
    it('keeps successful results separate from sign-in readiness', async () => {
        const c = { componentId: 'github-cli' as const, phase: 'idle' as const, observation: observation('github-cli', '1.1.0') };
        c.observation.authentication!.status='missing';
        expect(describeEnvironmentCell(c)).toMatchObject({ state: 'login', action: 'manual' });
        const tunnel = { ...c, componentId: 'cloudflared' as const, observation: observation('cloudflared','1.1.0') };
        tunnel.observation.details={kind:'cloudflared',tunnelCertificatePresent:false};
        expect(describeEnvironmentCell(tunnel)).toMatchObject({ state:'optional-login', action: null });
    });
});
