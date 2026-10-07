import { beforeAll, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
vi.mock('expo-crypto', () => ({ getRandomBytes: (size: number) => new Uint8Array(size) }));
vi.mock('@/encryption/libsodium.lib', () => ({ default: sodium }));
import { decryptAppConversationHistory, parseAppConversationHistory, type AppConversationHistory } from './appConversationHistory';
const key = new Uint8Array(32).fill(7);
const envelope = { v: 1, grantId: 'grant', machineId: 'machine', appId: 'relationship-advisor', scope: 'codex:chat', expiresAt: null, key: Buffer.from(key).toString('base64') };
const context = { v: 1, grantId: 'grant', conversationId: 'conversation', turnId: 'turn' };
const base: Extract<AppConversationHistory, { protocol?: undefined }> = { app: { id: 'relationship-advisor', origin: 'https://advisor.paws.rodeo' }, conversationId: 'conversation', grantId: 'grant', machineId: 'machine', grantExpiresAt: null, machineEnvelope: 'sealed', createdAt: '2026-10-03T07:00:00.000Z', turns: [] };
beforeAll(async () => { await sodium.ready; });
function seal(value: unknown) {
    const nonce = new Uint8Array(24);
    return Buffer.from([...nonce, ...sodium.crypto_secretbox_easy(new TextEncoder().encode(JSON.stringify(value)), nonce, key)]).toString('base64');
}
function history(input: Record<string, unknown> = {}, output: Record<string, unknown> = {}): AppConversationHistory {
    return { ...base, turns: [{ id: 'turn', input: seal({ ...context, direction: 'input', sequence: 0, messages: [{ role: 'user', text: 'Original question' }], ...input }), output: seal({ ...context, direction: 'output', sequence: 2, text: 'Original answer', ...output }), sequence: 2, state: 'completed', createdAt: base.createdAt }] };
}
it('reads original encrypted messages and safe images in Paws without producing credentials or a URL', () => {
    const result = decryptAppConversationHistory(history({ messages: [{ role: 'user', text: 'Question', images: Array(4).fill('data:image/png;base64,AA==') }] }), envelope);
    expect(result.messages).toEqual([{ role: 'user', text: 'Question', images: Array(4).fill('data:image/png;base64,AA==') }, { role: 'assistant', text: 'Original answer' }]);
    expect(result).not.toHaveProperty('token'); expect(result).not.toHaveProperty('key');
});
it.each(['grantId', 'machineId', 'appId', 'scope', 'expiresAt', 'v', 'key'])('rejects wrong envelope %s', field => {
    expect(() => decryptAppConversationHistory(history(), { ...envelope, [field]: 'wrong' })).toThrow();
});
it.each(['grantId', 'conversationId', 'turnId', 'direction', 'sequence'])('rejects replayed input or output %s', field => {
    expect(() => decryptAppConversationHistory(history({ [field]: 'wrong' }), envelope)).toThrow();
    expect(() => decryptAppConversationHistory(history({}, { [field]: 'wrong' }), envelope)).toThrow();
});
it('checks selected conversation, app origin and safe image sources', () => {
    expect(() => parseAppConversationHistory(base, 'different')).toThrow();
    expect(() => parseAppConversationHistory({ ...base, app: { ...base.app, origin: 'https://other.example' } }, base.conversationId)).toThrow();
    expect(() => decryptAppConversationHistory(history({ messages: [{ role: 'user', text: '', images: ['https://tracking.example/image'] }] }), envelope)).toThrow();
});
it('supports empty, running, failed and cancelled history', () => {
    expect(decryptAppConversationHistory(base, envelope)).toMatchObject({ messages: [], state: 'idle' });
    for (const state of ['running', 'failed', 'cancelled'] as const) {
        const data = history(); data.turns[0] = { ...data.turns[0], output: null, state };
        expect(decryptAppConversationHistory(data, envelope)).toMatchObject({ messages: [{ role: 'user', text: 'Original question' }], state });
    }
});
it('binds protocol 3 scopes and Codex/Claude model selections', () => {
    const selection = { engine: 'claude', model: 'claude-opus-4-6' };
    const data = { ...history({ v: 2, selection }, { v: 2, selection }), grantProtocol: 3 };
    const modern = { ...envelope, scope: 'agent:chat', protocol: 3 };
    expect(decryptAppConversationHistory(data, modern).messages[1].selection).toEqual(selection);
    expect(() => decryptAppConversationHistory(data, envelope)).toThrow();
    expect(() => decryptAppConversationHistory(history({ v: 2, selection }, { v: 2, selection: { ...selection, engine: 'codex' } }), envelope)).toThrow();
    expect(() => decryptAppConversationHistory(history({ v: 2 }), envelope)).toThrow();
});

const serviceBinding = { id: 'conversation', appId: 'relationship-advisor', serviceId: 'service', revision: 1,
    machineId: 'machine', engine: 'codex', accountRef: { kind: 'codex-profile', id: 'profile' },
    requestedModel: null, reasoning: { mode: 'default' }, permissions: ['chat'] };
const serviceScope = { appId: serviceBinding.appId, serviceId: 'service', targets: [{ machineId: 'machine',
    engine: 'codex', accountRef: serviceBinding.accountRef }], permissions: ['chat'], expiresAt: null };
const serviceEnvelope = { protocol: 'ai-services/1', grantId: 'grant', ownerId: 'owner', appId: serviceBinding.appId,
    serviceId: 'service', machineId: 'machine', scope: serviceScope, messageKey: Buffer.from(key).toString('base64') };
const serviceContext = { protocol: 'ai-services/1', grantId: 'grant', appId: serviceBinding.appId, serviceId: 'service',
    bindingId: 'conversation', requestId: 'request' };
function serviceHistory(input: Record<string, unknown> = {}, output: Record<string, unknown> = {}) {
    return { ...base, protocol: 'ai-services/1', ownerId: 'owner', binding: serviceBinding, scope: serviceScope,
        turns: [{ id: 'turn', requestId: 'request', sequence: 2, state: 'completed', createdAt: base.createdAt,
            input: seal({ ...serviceContext, direction: 'input', sequence: 0,
                messages: [{ role: 'user', text: 'Prior question' }, { role: 'assistant', text: 'Prior answer' }, { role: 'user', text: 'New question' }], ...input }),
            output: seal({ ...serviceContext, turnId: 'turn', direction: 'output', sequence: 2, text: 'New answer', ...output }) }] };
}
it('reads new service history including its previous messages without exposing grant keys', () => {
    const history = parseAppConversationHistory(serviceHistory(), 'conversation');
    const result = decryptAppConversationHistory(history, serviceEnvelope);
    expect(result.messages.map(message => message.text)).toEqual(['Prior question', 'Prior answer', 'New question', 'New answer']);
    expect(result.state).toBe('completed');
    expect(result).not.toHaveProperty('messageKey'); expect(result).not.toHaveProperty('scope');
});
it.each(['ownerId', 'grantId', 'appId', 'serviceId', 'machineId', 'protocol'])('rejects a service envelope with a different %s', field => {
    const history = parseAppConversationHistory(serviceHistory(), 'conversation');
    expect(() => decryptAppConversationHistory(history, { ...serviceEnvelope, [field]: 'foreign' })).toThrow();
});
it.each(['grantId', 'appId', 'serviceId', 'bindingId', 'requestId', 'direction', 'sequence'])('rejects service input/output replay with a different %s', field => {
    expect(() => decryptAppConversationHistory(parseAppConversationHistory(serviceHistory({ [field]: 'foreign' }), 'conversation'), serviceEnvelope)).toThrow();
    expect(() => decryptAppConversationHistory(parseAppConversationHistory(serviceHistory({}, { [field]: 'foreign' }), 'conversation'), serviceEnvelope)).toThrow();
});
it('rejects a substituted service binding, output turn and grant scope', () => {
    expect(() => parseAppConversationHistory({ ...serviceHistory(), binding: { ...serviceBinding, id: 'foreign' } }, 'conversation')).toThrow();
    expect(() => decryptAppConversationHistory(parseAppConversationHistory(serviceHistory({}, { turnId: 'foreign' }), 'conversation'), serviceEnvelope)).toThrow();
    expect(() => decryptAppConversationHistory(parseAppConversationHistory(serviceHistory(), 'conversation'), { ...serviceEnvelope, scope: { ...serviceScope, permissions: ['chat', 'tools'] } })).toThrow();
});
it('keeps accepted, cancellation and interrupted service history readable', () => {
    for (const state of ['accepted', 'cancel-requested', 'interrupted']) {
        const raw = serviceHistory(); raw.turns[0].state = state;
        const result = decryptAppConversationHistory(parseAppConversationHistory(raw, 'conversation'), serviceEnvelope);
        expect(result.messages).toHaveLength(4);
        expect(result.state).toBe(state === 'accepted' ? 'queued' : state === 'cancel-requested' ? 'running' : 'failed');
    }
});
