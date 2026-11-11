import * as React from 'react';
import { act } from 'react';
// @ts-expect-error react-test-renderer has no declarations.
import TestRenderer from 'react-test-renderer';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
const mock = vi.hoisted(() => ({ raw: undefined as string | undefined, current: true }));
vi.mock('@/auth/accountRuntime', () => ({ accountRuntimeCurrent: () => mock.current, getRuntimeAccountSelection: () => ({ key: 'a', scope: 'a', serverUrl: 'https://a.test', generation: '1' }) }));
vi.mock('@/sync/persistence', () => ({ loadProjectWorkspaceCache: () => mock.raw, saveProjectWorkspaceCache: (raw: string) => { mock.raw = raw; } }));
vi.mock('@/sync/storage', () => ({ storage: vi.fn(), useMachine: vi.fn(), useSocketStatus: vi.fn() }));
vi.mock('@/sync/projectGoals', () => ({ loadGoalProjects: vi.fn(), loadProjectGoalBoard: vi.fn() }));
import { useCachedProjectResource } from './useProjectData';
import { readProjectCache, writeProjectCache, removeProjectSessionFromCache, subscribeProjectSessionDeletions, getProjectSessionDeletionRevision, isProjectSessionDeleted } from '@/sync/projectWorkspaceCache';
const schema = z.array(z.string());
let renderer: any;
let result: ReturnType<typeof useCachedProjectResource<string[]>>;
function deferred() { let resolve!: (value: string[]) => void; let reject!: (error: Error) => void; const promise = new Promise<string[]>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function Host(props: { owner: string; read: () => Promise<string[]>; enabled: boolean; revision?: string }) {
    result = useCachedProjectResource(props.owner, schema, props.read, props.enabled, props.revision); return null;
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mock.raw = undefined; mock.current = true; });
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = null; });
it('renders cached data immediately, keeps it through failure, and replaces it on explicit retry', async () => {
    writeProjectCache('a', ['last real project']); const pending = deferred(); const read = vi.fn(() => pending.promise);
    act(() => { renderer = TestRenderer.create(<Host owner="a" read={read} enabled />); });
    expect(result.value).toEqual(['last real project']); expect(result.loading).toBe(true); expect(result.fresh).toBe(false);
    await act(async () => pending.reject(new Error('Offline')));
    expect(result.value).toEqual(['last real project']); expect(result.error).toBe('Offline'); expect(result.loading).toBe(false);
    read.mockResolvedValue([]); await act(async () => { await result.refresh(); });
    expect(result.value).toEqual([]); expect(result.fresh).toBe(true); expect(result.error).toBeNull();
});
it('ignores late data after switching owner and never flashes the previous machine', async () => {
    const first = deferred(); const second = deferred(); const a = () => first.promise; const b = () => second.promise;
    act(() => { renderer = TestRenderer.create(<Host owner="a" read={a} enabled />); });
    act(() => renderer.update(<Host owner="b" read={b} enabled />)); expect(result.value).toBeNull();
    await act(async () => first.resolve(['wrong owner'])); expect(result.value).toBeNull(); expect(readProjectCache('a', schema)).toBeNull();
    await act(async () => second.resolve(['b'])); expect(result.value).toEqual(['b']);
});
it('stops a spinner when disconnected and does not commit the old in-flight response', async () => {
    writeProjectCache('a', ['cached']); const pending = deferred(); const read = () => pending.promise;
    act(() => { renderer = TestRenderer.create(<Host owner="a" read={read} enabled />); });
    act(() => renderer.update(<Host owner="a" read={read} enabled={false} />));
    expect(result.loading).toBe(false); expect(result.value).toEqual(['cached']);
    await act(async () => pending.resolve(['late'])); expect(result.value).toEqual(['cached']); expect(result.fresh).toBe(false);
});
it('an event revision supersedes an earlier read and preserves the latest response', async () => {
    const first = deferred(), second = deferred(); const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    act(() => { renderer = TestRenderer.create(<Host owner="a" read={read} enabled revision="old" />); });
    act(() => renderer.update(<Host owner="a" read={read} enabled revision="new" />));
    await act(async () => second.resolve(['new'])); await act(async () => first.resolve(['old']));
    expect(read).toHaveBeenCalledTimes(2); expect(result.value).toEqual(['new']); expect(readProjectCache('a', schema)?.value).toEqual(['new']);
});

it('a cache-only 404 immediately removes the mounted conversation candidate', () => {
    let visible = true;
    function CachedConversation() {
        const revision = React.useSyncExternalStore(subscribeProjectSessionDeletions, getProjectSessionDeletionRevision, getProjectSessionDeletionRevision);
        visible = React.useMemo(() => !isProjectSessionDeleted('only-cached'), [revision]);
        return null;
    }
    act(() => { renderer = TestRenderer.create(<CachedConversation />); });
    expect(visible).toBe(true);
    act(() => removeProjectSessionFromCache('only-cached'));
    expect(visible).toBe(false);
});
