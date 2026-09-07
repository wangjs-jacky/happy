import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ server: 'https://server.test', apply: vi.fn() }));
vi.mock('expo-application', () => ({ applicationId: 'build.paws.preview', nativeApplicationVersion: '1.7.1' }));
vi.mock('expo-updates', () => ({ runtimeVersion: '22', channel: 'preview' }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('./serverConfig', () => ({ getServerUrl: () => state.server }));
vi.mock('./storage', () => ({ storage: { getState: () => ({ applyNativeUpdateStatus: state.apply }) } }));
import { refreshNativeUpdateStatus } from './nativeUpdate';
beforeEach(() => { state.server = 'https://server.test'; state.apply.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe('installed native identity and update state', () => {
    it('sends the real binary runtime and package, not mutable OTA config', async () => {
        const request = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ status: 'up-to-date', update_required: false, update_url: null, updateUrl: null })));
        vi.stubGlobal('fetch', request);
        await refreshNativeUpdateStatus();
        expect(JSON.parse(request.mock.calls[0][1].body as string)).toEqual({ platform: 'android', version: '1.7.1',
            app_id: 'build.paws.preview', runtime_version: '22', channel: 'preview' });
        expect(state.apply).toHaveBeenCalledWith({ status: 'up-to-date', available: false });
    });
    it('keeps failures unknown instead of storing available=false', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
        await expect(refreshNativeUpdateStatus()).rejects.toThrow();
        expect(state.apply).toHaveBeenCalledWith(null);
    });
    it('does not apply an old server response after server selection changes', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => {
            state.server = 'https://new-server.test';
            return new Response(JSON.stringify({ status: 'up-to-date', update_required: false, update_url: null, updateUrl: null }));
        }));
        await expect(refreshNativeUpdateStatus()).rejects.toThrow('Server changed');
        expect(state.apply).not.toHaveBeenCalled();
    });
});
