import React, { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error narrow renderer harness
import TestRenderer from 'react-test-renderer';
import type { ComponentObservation } from '@slopus/happy-wire';
const mocks = vi.hoisted(() => ({ credentials: {}, machines: [{ id: 'a', active: true, createdAt: 1 }], inspect: vi.fn(), apply: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({credentials:mocks.credentials}), getCurrentAuth: () => ({credentials:mocks.credentials}) }));
vi.mock('@/sync/storage', () => ({ useAllMachines: () => mocks.machines, storage: {getState: () => ({machines:{a:mocks.machines[0]}})} }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'fixture' }));
vi.mock('@/environment/environmentOps', () => ({ inspectMachineEnvironment: mocks.inspect, applyMachineEnvironment: mocks.apply }));
import { useEnvironmentDashboard, type EnvironmentDashboardController } from './useEnvironmentDashboard';

describe('environment dashboard modal lifetime', () => {
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
        } finally {act(()=>renderer?.unmount());}
    });
});
