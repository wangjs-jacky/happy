import { describe, expect, it, vi } from 'vitest';
import { decodeBase64, decrypt } from '../crypto/encryption';
import { RecordEncryptionStore } from '../crypto/records';
import { MessagesResourceImpl } from './messages';

describe('MessagesResource', () => {
    it('sends through the idempotent HTTP endpoint with an observable localId', async () => {
        const key = Uint8Array.from({ length: 32 }, (_, index) => index);
        const encryption = new RecordEncryptionStore();
        encryption.setSession('session-1', { key, variant: 'legacy' });
        const transport = { post: vi.fn().mockResolvedValue({ messages: [] }) };
        const sessions = { get: vi.fn() };
        const messages = new MessagesResourceImpl(transport as never, sessions as never, encryption);

        const receipt = await messages.send({ sessionId: 'session-1', text: 'hello', localId: 'local-1' });

        expect(receipt).toEqual({ sessionId: 'session-1', localId: 'local-1' });
        const body = transport.post.mock.calls[0][1] as { messages: Array<{ localId: string; content: string }> };
        expect(body.messages[0].localId).toBe('local-1');
        expect(decrypt(key, 'legacy', decodeBase64(body.messages[0].content))).toMatchObject({
            role: 'user',
            content: { type: 'text', text: 'hello' },
            meta: { sentFrom: 'paws-agent' },
        });
    });
});
