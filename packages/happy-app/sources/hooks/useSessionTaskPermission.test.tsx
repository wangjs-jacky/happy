import * as React from 'react';
import { act } from 'react';
// @ts-expect-error no react-test-renderer declarations
import TestRenderer from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionTaskPermission } from './useSessionTaskPermission';

const mocks = vi.hoisted(() => ({ setMode: vi.fn(), updateMode: vi.fn(), confirm: vi.fn(), alert: vi.fn() }));
vi.mock('@/sync/ops', () => ({ sessionSetPermissionMode: mocks.setMode }));
vi.mock('@/sync/storage', () => ({
    useSetting: () => ({}), storage: { getState: () => ({ updateSessionPermissionMode: mocks.updateMode }) },
}));
vi.mock('@/modal', () => ({ Modal: { confirm: mocks.confirm, alert: mocks.alert } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

let controller: ReturnType<typeof useSessionTaskPermission>;
function Harness({ id }: { id: string }) {
    controller = useSessionTaskPermission({ id, metadata: { flavor: 'antigravity' } } as any, true);
    return null;
}

describe('acknowledged Antigravity permission controls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.confirm.mockResolvedValue(true);
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    });
    afterEach(() => vi.restoreAllMocks());

    it('stores full access only after the active worker acknowledges the change', async () => {
        let finish!: (accepted: boolean) => void;
        mocks.setMode.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<Harness id="agy-ack" />); });
        expect(controller.supported).toBe(true);
        const pending = controller.onLevelChange('full-access');
        await act(async () => { await Promise.resolve(); });
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.setMode).toHaveBeenCalledWith('agy-ack', 'bypassPermissions');
        expect(mocks.updateMode).not.toHaveBeenCalled();
        await act(async () => { finish(true); await pending; });
        expect(mocks.updateMode).toHaveBeenCalledWith('agy-ack', 'bypassPermissions');
        act(() => renderer.unmount());
    });

    it('keeps confirmation mode if the worker rejects or lacks the new RPC', async () => {
        mocks.setMode.mockRejectedValue(new Error('worker unavailable'));
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<Harness id="agy-old-worker" />); });
        await act(async () => { expect(await controller.onLevelChange('full-access')).toBe(false); });
        expect(mocks.updateMode).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalled();
        act(() => renderer.unmount());
    });
});
