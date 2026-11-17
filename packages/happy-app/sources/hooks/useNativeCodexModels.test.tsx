import React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ credentials: { token: 'one' }, server: 'https://paws', rpc: vi.fn() }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: mocks.credentials }), getCurrentAuth: () => ({ credentials: mocks.credentials }) }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => mocks.server }));
vi.mock('@/sync/apiSocket', () => ({ apiSocket: { machineRPC: mocks.rpc } }));
import { useNativeCodexModels } from './useNativeCodexModels';
let value: ReturnType<typeof useNativeCodexModels>;
function Harness({ machine = 'mini' }: { machine?: string }) { value = useNativeCodexModels(machine); return null; }
let tree: any;
afterEach(() => { if (tree) act(() => tree.unmount()); mocks.rpc.mockReset(); mocks.credentials = { token: 'one' }; });
describe('native catalog event and owner isolation', () => {
    it('only queries on explicit refresh and shares the in-flight request', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        let finish!: (v: unknown) => void;
        mocks.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        act(() => { tree = TestRenderer.create(<Harness />); });
        expect(mocks.rpc).not.toHaveBeenCalled();
        let a!: Promise<void>, b!: Promise<void>;
        act(() => { a = value.refresh(); b = value.refresh(); });
        expect(a).toBe(b);
        await act(async () => { finish({ type: 'success', models: [{ code: 'deepseek/DeepSeek-V4.1-Flash', value: 'DeepSeek' }] }); await a; });
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
        expect(value.models[0].key).toBe('deepseek/DeepSeek-V4.1-Flash');
    });
    it('rejects late results from a previous machine or auth owner', async () => {
        let finish!: (v: unknown) => void;
        mocks.rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        act(() => { tree = TestRenderer.create(<Harness />); });
        const promise = value.refresh();
        act(() => { tree.update(<Harness machine="air" />); });
        await act(async () => { finish({ type: 'success', models: [{ code: 'old', value: 'Old' }] }); await promise; });
        expect(value.models).toEqual([]);
        const second = value.refresh();
        mocks.credentials = { token: 'other' };
        act(() => { tree.update(<Harness machine="air" />); });
        await act(async () => { finish({ type: 'success', models: [{ code: 'foreign', value: 'Foreign' }] }); await second; });
        expect(value.models).toEqual([]);
    });
    it('does not expose an RPC error or replace a valid catalog with malformed data', async () => {
        mocks.rpc.mockResolvedValue({ type: 'success', models: [{ code: 'known', value: 'Known' }] });
        act(() => { tree = TestRenderer.create(<Harness />); });
        await act(async () => { await value.refresh(); });
        mocks.rpc.mockResolvedValue({ type: 'error', errorMessage: 'private-provider-details' });
        await act(async () => { await expect(value.refresh()).rejects.toThrow('native-model-catalog-unavailable'); });
        expect(value.models.map(model => model.key)).toEqual(['known']);
    });
});
