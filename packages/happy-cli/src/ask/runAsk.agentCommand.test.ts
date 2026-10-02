import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: null as ((message: any) => void) | null,
    kill: null as (() => Promise<void>) | null,
    send: vi.fn(),
    stream: vi.fn(),
}));
const session = {
    onUserMessage: vi.fn(handler => { mocks.user = handler; }),
    on: vi.fn(), keepAlive: vi.fn(), sendSessionEvent: vi.fn(),
    sendSessionProtocolMessage: mocks.send,
    updateMetadata: vi.fn(), sendSessionDeath: vi.fn(),
    flush: vi.fn(async () => {}), close: vi.fn(async () => {}),
    rpcHandlerManager: { registerHandler: vi.fn() },
};
vi.mock('@/api/api', () => ({ ApiClient: { create: vi.fn(async () => ({
    getOrCreateMachine: vi.fn(async () => ({})), getOrCreateSession: vi.fn(async () => null),
})) } }));
vi.mock('@/persistence', () => ({ readSettings: vi.fn(async () => ({ machineId: 'test-machine' })) }));
vi.mock('@/daemon/run', () => ({ initialMachineMetadata: {} }));
vi.mock('@/utils/createSessionMetadata', () => ({ createSessionMetadata: () => ({ state: {}, metadata: {} }) }));
vi.mock('@/utils/setupOfflineReconnection', () => ({ setupOfflineReconnection: () => ({ session, reconnectionHandle: null }) }));
vi.mock('@/claude/registerKillSessionHandler', () => ({ registerKillSessionHandler: (_manager: unknown, handler: () => Promise<void>) => { mocks.kill = handler; } }));
vi.mock('@/deepseek/deepseekCredentials', () => ({ resolveDeepSeekApiKey: () => ({ key: 'test-key', source: 'test' }) }));
vi.mock('@/deepseek/deepseekClient', async original => ({ ...await original<typeof import('@/deepseek/deepseekClient')>(), streamDeepSeekChat: mocks.stream }));
vi.mock('./askTools', () => ({ buildAskAugmentedUserContent: async (text: string) => text }));

import { runAsk } from './runAsk';

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('refuses /agent visibly without calling the model or polluting ordinary Ask history', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    mocks.stream.mockImplementation(async function* () { yield { contentDelta: 'ordinary answer' }; });
    void runAsk({ credentials: { token: 'test-token' } as any });
    // Startup uses only the mocked local API promises.
    for (let index = 0; index < 10 && !mocks.user; index++) await Promise.resolve();
    expect(mocks.user).toBeTypeOf('function');
    mocks.user!({ content: { text: 'Continuation history' }, meta: { myAgentCommand: { request: '创建军师' } } });
    for (let index = 0; index < 5; index++) await Promise.resolve();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls.some(([envelope]) => envelope.ev.t === 'text'
        && envelope.ev.text.includes('Ask does not expose Happy'))).toBe(true);
    expect(mocks.send.mock.calls.some(([envelope]) => envelope.ev.t === 'turn-end' && envelope.ev.status === 'completed')).toBe(true);
    mocks.user!({ content: { text: 'an ordinary question' } });
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][0].messages.filter((message: any) => message.role === 'user'))
        .toEqual([{ role: 'user', content: 'an ordinary question' }]);
    await mocks.kill!();
});
