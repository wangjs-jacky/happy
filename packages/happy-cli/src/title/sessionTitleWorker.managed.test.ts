import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ providers: [] as unknown[], nativeStarts: 0 }));
vi.mock('@/codex/codexAppServerClient', () => ({ CodexAppServerClient: class {
    handler: any;
    setEventHandler(handler: any) { this.handler = handler; }
    setApprovalHandler() {}
    setManagedAccessProvider(provider: unknown) { state.providers.push(provider); }
    async connect() { state.nativeStarts++; }
    async startThread() {}
    async sendTurnAndWait() { this.handler({ type: 'agent_message', message: 'Managed title' }); return { aborted: false }; }
    async disconnect() {}
} }));
import { registerSessionTitleWorker } from './sessionTitleWorker';
afterEach(() => { vi.unstubAllEnvs(); state.providers = []; state.nativeStarts = 0; });
describe('bound-account title generation', () => {
    const register = (factory?: any) => {
        let handler: any;
        registerSessionTitleWorker({ updateMetadata() {}, async updateMetadataAndAwait() {}, rpcHandlerManager: { registerHandler(_method: string, h: any) { handler = h; } } } as any, 'codex', factory);
        return handler;
    };
    it('uses the managed authority before opening a title worker', async () => {
        vi.stubEnv('HAPPY_CODEX_ACCOUNT_PROFILE_ID', 'profile');
        const provider = vi.fn();
        const handler = register(async () => provider);
        const result = await handler({ transcript: 'Test task' });
        expect(result.success).toBe(true);
        expect(state.providers).toEqual([provider]);
        expect(state.nativeStarts).toBe(1);
    });
    it('fails closed if a bound account title path lacks the managed authority', async () => {
        vi.stubEnv('HAPPY_CODEX_ACCOUNT_PROFILE_ID', 'profile');
        const result = await register()({ transcript: 'Test task' });
        expect(result.success).toBe(false);
        expect(state.nativeStarts).toBe(0);
    });
});
