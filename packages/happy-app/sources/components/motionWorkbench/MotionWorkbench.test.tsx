import * as React from 'react';
import { act } from 'react';
// @ts-expect-error react-test-renderer has no declarations.
import TestRenderer from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    current: true, nonce: '', clients: [] as any[], session: { metadata: { motionWorkbenchChanges: [] as any[] }, agentState: undefined as undefined | { turnStatus: { status: string; turnId: string; updatedAt: number } } },
    rpc: vi.fn(), queue: vi.fn(),
}));
vi.mock('react-native', () => ({ View: 'View', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator' }));
vi.mock('react-native-unistyles', () => ({ useUnistyles: () => ({ theme: { dark: true, colors: { surface: 'surface', divider: 'divider', text: 'text', textSecondary: 'secondary', textDestructive: 'error' } } }) }));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/components/fileWorkspace/WorkspaceButton', () => ({ WorkspaceButton: 'WorkspaceButton' }));
vi.mock('@/auth/accountRuntime', () => ({ accountRuntimeCurrent: () => state.current, getRuntimeAccountSelection: () => ({ key: 'account' }) }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://paws.invalid' }));
vi.mock('@/utils/sessionUtils', () => ({ resolveSessionState: () => ({ isConnected: true }) }));
vi.mock('@/sync/storage', () => ({ useSession: () => state.session, useSocketStatus: () => ({ status: 'connected' }) }));
vi.mock('@/sync/motionWorkbench.web', () => ({ motionWorkbenchRequest: state.rpc, MotionWorkbenchRpcError: class extends Error { code = 'STALE_REVIEW'; } }));
vi.mock('@/sync/messageStagingQueueRuntime', () => ({ stageSessionMessage: state.queue }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./studioClient.web', () => ({
    motionStudioFrameHtml: (_bundle: unknown, nonce: string) => { state.nonce = nonce; return '<html></html>'; },
    createStudioClient: () => {
        const id = `00000000-0000-4000-8000-${String(state.clients.length + 1).padStart(12, '0')}`;
        const client = { open: vi.fn(async () => ({ descriptor: { bindingId: id, state: { document: { title: 'Paws 宣传片' } } }, bundle: { licenseText: 'GPL' }, assets: [] })),
            close: vi.fn(async () => true), getBindingId: () => id, state: vi.fn(), operation: vi.fn() };
        state.clients.push(client); return client;
    },
}));
import { MotionWorkbench } from './MotionWorkbench.web';

const snapshot = { projectId: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), markers: [{ id: 'note', requestVersion: 1, label: 'AI 标记', notes: '只改工程名' }] };
let renderer: any;
const listeners = new Set<(event: any) => void>();
const frameWindow = {};
const ports: any[] = [];
const button = (testID: string) => renderer.root.findByProps({ testID });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    state.current = true; state.clients.length = 0; state.session.metadata.motionWorkbenchChanges = []; state.session.agentState = undefined; state.nonce = '';
    state.rpc.mockReset().mockImplementation(async (_session, method) => method === 'motionWorkbenchInspect' ? snapshot : method === 'motionWorkbenchPrepareReview' ? { prompt: 'verified instructions' } : { closed: true });
    state.queue.mockReset().mockResolvedValue(undefined); listeners.clear(); ports.length = 0;
    const storage = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null,
        getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    vi.stubGlobal('window', { addEventListener: (_type: string, listener: (event: any) => void) => listeners.add(listener), removeEventListener: (_type: string, listener: (event: any) => void) => listeners.delete(listener) });
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); renderer = null; vi.unstubAllGlobals(); });
async function mount(strict = false, onProjectTitleChange?: (title: string) => void) {
    const view = <MotionWorkbench sessionId="session" projectPath="/owned/movie" visible onClose={() => {}} onProjectTitleChange={onProjectTitleChange} />;
    await act(async () => { renderer = TestRenderer.create(strict ? <React.StrictMode>{view}</React.StrictMode> : view, { createNodeMock: (element: any) => element.type === 'iframe' ? { contentWindow: frameWindow } : null }); });
}
function connect(nonce = state.nonce, source = frameWindow) {
    const port: any = { onmessage: null, close: vi.fn(), postMessage: vi.fn((message: any) => {
        if (message.type === 'prepare-close') queueMicrotask(() => port.onmessage?.({ data: { type: 'close-ready', id: message.id } }));
        if (message.type === 'context') queueMicrotask(() => port.onmessage?.({ data: { type: 'context', id: message.id, value: { playback: { time: 6.5 } } } }));
    }) };
    ports.push(port);
    for (const listener of listeners) listener({ source, data: { type: 'paws-motion-frame-ready', nonce }, ports: [port] });
    return port;
}
async function ready() { let port: any; await act(async () => { port = connect(); port.onmessage({ data: { type: 'ready' } }); }); return port; }

describe('workbench ownership and AI submission', () => {
    it('publishes the saved project title on open and on a native edit or refresh', async () => {
        const title = vi.fn();
        await mount(false, title);
        expect(title).toHaveBeenLastCalledWith('Paws 宣传片');
        const port = await ready();
        state.clients.at(-1).operation.mockResolvedValue({ value: { state: { document: { title: '新片名' } } }, assets: [] });
        await act(async () => port.onmessage({ data: { id: 1, type: 'operation', input: { route: 'document/commit' } } }));
        expect(title).toHaveBeenLastCalledWith('新片名');
        state.clients.at(-1).state.mockResolvedValue({ value: { document: { title: 'AI 保存的片名' } }, assets: [] });
        await act(async () => port.onmessage({ data: { id: 2, type: 'state', input: {} } }));
        expect(title).toHaveBeenLastCalledWith('AI 保存的片名');
        expect(JSON.stringify(renderer.toJSON())).toContain('AI 保存的片名');
    });
    it('does not start duplicate native opens during React StrictMode remounting', async () => {
        await mount(true);
        expect(state.clients.reduce((count, client) => count + client.open.mock.calls.length, 0)).toBe(1);
    });
    it('never sends project data to a foreign frame or nonce and accepts one owned child channel', async () => {
        await mount(); const wrongSource = connect(state.nonce, {}), wrongNonce = connect('00000000-0000-4000-8000-000000000999');
        expect(wrongSource.postMessage).not.toHaveBeenCalled(); expect(wrongNonce.postMessage).not.toHaveBeenCalled();
        const owned = connect(); expect(owned.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'paws-motion-connect' }));
        const duplicate = connect(); expect(duplicate.close).toHaveBeenCalledOnce(); expect(duplicate.postMessage).not.toHaveBeenCalled();
    });
    it('queues the exact revalidated review once even when send is clicked twice', async () => {
        await mount(); await ready(); await act(async () => button('motion-review-open').props.onPress());
        await act(async () => { button('motion-review-send').props.onPress(); button('motion-review-send').props.onPress(); });
        expect(state.rpc.mock.calls.filter(([, method]) => method === 'motionWorkbenchPrepareReview')).toEqual([['session', 'motionWorkbenchPrepareReview', {
            projectPath: '/owned/movie', projectId: snapshot.projectId, snapshotHash: snapshot.snapshotHash, markers: [{ id: 'note', requestVersion: 1 }],
        }]]);
        expect(state.queue).toHaveBeenCalledExactlyOnceWith('session', 'verified instructions', undefined, 'queue', expect.objectContaining({ displayText: expect.stringContaining('只改工程名') }));
    });
    it('requires a fresh selection snapshot after a native document invalidation', async () => {
        await mount(); const port = await ready(); await act(async () => button('motion-review-open').props.onPress());
        state.session.metadata.motionWorkbenchChanges = [{ bindingId: state.clients.at(-1).getBindingId(), sequence: 1 }];
        await act(async () => renderer.update(<MotionWorkbench sessionId="session" projectPath="/owned/movie" visible onClose={() => {}} />));
        expect(port.postMessage).toHaveBeenCalledWith({ type: 'refresh' });
        expect(button('motion-review-send').props.disabled).toBe(true); expect(JSON.stringify(renderer.toJSON())).toContain('motionWorkbench.reviewChanged');
        await act(async () => button('motion-review-open').props.onPress()); expect(button('motion-review-send').props.disabled).toBe(false);
    });
    it('never queues a prepared review after the account runtime has changed', async () => {
        await mount(); await ready(); await act(async () => button('motion-review-open').props.onPress());
        state.rpc.mockImplementation(async () => { state.current = false; return { prompt: 'stale account' }; });
        await act(async () => button('motion-review-send').props.onPress()); expect(state.queue).not.toHaveBeenCalled();
    });
    it('refreshes a completed Agent build through its existing event and does not replay historical completion', async () => {
        state.session.agentState = { turnStatus: { status: 'completed', turnId: 'old', updatedAt: 1 } };
        await mount(); const port = await ready(); expect(port.postMessage).not.toHaveBeenCalledWith({ type: 'refresh' });
        state.session.agentState = { turnStatus: { status: 'completed', turnId: 'new', updatedAt: 2 } };
        await act(async () => renderer.update(<MotionWorkbench sessionId="session" projectPath="/owned/movie" visible onClose={() => {}} />));
        expect(port.postMessage.mock.calls.filter(([message]: any[]) => message.type === 'refresh')).toHaveLength(1);
        await act(async () => renderer.update(<MotionWorkbench sessionId="session" projectPath="/owned/movie" visible onClose={() => {}} />));
        expect(port.postMessage.mock.calls.filter(([message]: any[]) => message.type === 'refresh')).toHaveLength(1);
    });
    it.each(['before', 'after'])('safely reloads a changed native build %s Agent completion and restores the playhead', async order => {
        await mount(); const port = await ready();
        const change = () => port.onmessage({ data: { type: 'source-changed' } });
        if (order === 'before') await act(async () => change());
        expect(state.clients).toHaveLength(1);
        state.session.agentState = { turnStatus: { status: 'completed', turnId: 'new', updatedAt: 2 } };
        await act(async () => renderer.update(<MotionWorkbench sessionId="session" projectPath="/owned/movie" visible onClose={() => {}} />));
        if (order === 'after') await act(async () => change());
        expect(state.clients).toHaveLength(2); expect(state.clients[0].close).toHaveBeenCalledOnce();
        const next = await ready(); expect(next.postMessage).toHaveBeenCalledWith({ type: 'seek', time: 6.5 });
    });
    it('keeps an unconfirmed native draft and offers an explicit reload after a new build', async () => {
        await mount(); const port = await ready();
        port.postMessage.mockImplementation((message: any) => {
            if (message.type === 'prepare-close') queueMicrotask(() => port.onmessage({ data: { type: 'close-blocked', id: message.id, message: 'Keep native draft' } }));
        });
        state.session.agentState = { turnStatus: { status: 'completed', turnId: 'new', updatedAt: 2 } };
        await act(async () => renderer.update(<MotionWorkbench sessionId="session" projectPath="/owned/movie" visible onClose={() => {}} />));
        await act(async () => port.onmessage({ data: { type: 'source-changed' } }));
        expect(state.clients).toHaveLength(1); expect(state.clients[0].close).not.toHaveBeenCalled();
        expect(button('motion-reopen')).toBeDefined(); expect(JSON.stringify(renderer.toJSON())).toContain('Keep native draft');
    });
});
