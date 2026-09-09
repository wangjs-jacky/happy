import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error narrow renderer harness
import TestRenderer from 'react-test-renderer';
import type { ComponentObservation } from '@slopus/happy-wire';
const mocks = vi.hoisted(() => ({ credentials: {}, server: 'fixture', status: 'connected', machines: [{ id: 'a', active: true, createdAt: 1 }], inspect: vi.fn(), apply: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({credentials:mocks.credentials}), getCurrentAuth: () => ({credentials:mocks.credentials}) }));
vi.mock('@/sync/storage', () => ({ useAllMachines: () => mocks.machines, useSocketStatus: () => ({ status: mocks.status }), storage: {getState: () => ({machines:{a:mocks.machines[0]},socketStatus:mocks.status})} }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => mocks.server }));
vi.mock('@/environment/environmentOps', () => ({ inspectMachineEnvironment: mocks.inspect, applyMachineEnvironment: mocks.apply }));
import { useEnvironmentDashboard, type EnvironmentDashboardController } from './useEnvironmentDashboard';

describe('environment dashboard modal lifetime', () => {
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        mocks.credentials = {}; mocks.status = 'connected'; mocks.server = 'fixture';
        mocks.machines = [{ id: 'a', active: true, createdAt: 1 }];
        mocks.inspect.mockReset().mockResolvedValue({ observations: [] }); mocks.apply.mockReset();
    });
    it('waits for the initial socket connection, then automatically inspects cached devices', async () => {
        mocks.status = 'connecting';
        let current!: EnvironmentDashboardController;
        const Probe = () => { current = useEnvironmentDashboard(); return null; };
        let renderer: any;
        try {
            await act(async () => { renderer = TestRenderer.create(<Probe />); });
            expect(current.rows).toHaveLength(1);
            expect(current.lastChecked).toBeUndefined();
            expect(mocks.inspect).not.toHaveBeenCalled();
            mocks.status = 'connected';
            await act(async () => renderer.update(<Probe />));
            expect(mocks.inspect).toHaveBeenCalledTimes(1);
            expect(current.lastChecked).toBeDefined();
            expect(mocks.apply).not.toHaveBeenCalled();
        } finally { act(() => renderer?.unmount()); }
    });
    it('rechecks after transport reconnect even when device presence does not change', async () => {
        const Probe = () => { useEnvironmentDashboard(); return null; };
        let renderer: any;
        try {
            await act(async () => { renderer = TestRenderer.create(<Probe />); });
            expect(mocks.inspect).toHaveBeenCalledTimes(1);
            mocks.status = 'disconnected'; await act(async () => renderer.update(<Probe />));
            expect(mocks.inspect).toHaveBeenCalledTimes(1);
            mocks.status = 'connected'; await act(async () => renderer.update(<Probe />));
            expect(mocks.inspect).toHaveBeenCalledTimes(2);
        } finally { act(() => renderer?.unmount()); }
    });
    it.each(['account', 'server'] as const)('does not expose the old pending inspection after a %s switch', async kind => {
        let resolveOld!: (value: any) => void;
        mocks.inspect.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
        let current!: EnvironmentDashboardController;
        const Probe = () => { current = useEnvironmentDashboard(); return null; };
        let renderer: any;
        try {
            await act(async () => { renderer = TestRenderer.create(<Probe />); });
            const oldScan = current.scan;
            expect(current.scanning).toBe(true);
            if (kind === 'account') mocks.credentials = {}; else mocks.server = 'other-fixture';
            await act(async () => renderer.update(<Probe />));
            expect(current.scan).not.toBe(oldScan);
            const newRows = current.rows;
            await act(async () => resolveOld({ observations: [{ componentId: 'paws-cli', installedVersion: '99.0.0' }] }));
            expect(current.rows).toBe(newRows);
            expect(current.rows[0].cells['paws-cli'].observation).toBeUndefined();
            expect(mocks.apply).not.toHaveBeenCalled();
        } finally { act(() => renderer?.unmount()); }
    });
    it('retains the live task and completion result when reopened during an update', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const before = { componentId:'paws-cli',platform:'darwin',architecture:'arm64',support:'supported',installed:true,installedVersion:'1.0.0',resolvedExecutable:'/tool',capability:'alignable',inspectedAt:1,
            source:{kind:'npm-global',available:true,ownership:'verified',latestVersion:'1.1.0'},details:{kind:'paws-cli'} } as ComponentObservation;
        mocks.inspect.mockImplementation(async (_id, request) => ({ observations:[before], ...(request.desired ? {plans:[{componentId:'paws-cli',action:'upgrade',fromVersion:'1.0.0',targetVersion:'1.1.0',planFingerprint:'a'.repeat(64),expiresAt:Date.now()+10000}]} : {}) }));
        let complete!: (value: any) => void;
        mocks.apply.mockImplementation(() => new Promise(resolve => {complete=resolve;}));
        let current!: EnvironmentDashboardController;
        const Probe = () => { current=useEnvironmentDashboard(); return null; };
        let renderer: any;
        try {
            await act(async () => {renderer=TestRenderer.create(<Probe/>);});
            let updating!: Promise<void>;
            await act(async () => {updating=current.update({machineId:'a',componentId:'paws-cli'});});
            expect(current.running).toBe(true);
            act(()=>renderer.unmount());
            await act(async ()=>{renderer=TestRenderer.create(<Probe/>);});
            expect(current.running).toBe(true);
            await act(async ()=>{complete({result:{componentId:'paws-cli',status:'succeeded',before,after:{...before,installedVersion:'1.1.0'},changed:true}});await updating;});
            expect(current.batch).toMatchObject({done:1,succeeded:1});
            expect(current.rows[0].cells['paws-cli'].phase).toBe('succeeded');
            const calls = mocks.inspect.mock.calls.length;
            act(() => renderer.unmount());
            await act(async () => { renderer = TestRenderer.create(<Probe />); });
            expect(current.batch).toMatchObject({ done: 1, succeeded: 1 });
            expect(current.rows[0].cells['paws-cli'].phase).toBe('succeeded');
            expect(mocks.inspect).toHaveBeenCalledTimes(calls);
        } finally {act(()=>renderer?.unmount());}
    });
});
