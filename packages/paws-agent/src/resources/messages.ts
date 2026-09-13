import { PawsAgentError } from '../client/errors';
import type { Message, MessagesResource, SendMessageInput, SendMessageReceipt } from '../client/types';
import { decodeBase64, decrypt, encodeBase64, encrypt } from '../crypto/encryption';
import { RecordEncryptionStore } from '../crypto/records';
import type { PawsHttpTransport } from '../transport/http';
import type { SessionsResourceImpl } from './sessions';
import { encryptImage, snapshotImages } from './imageAttachments';

type RawMessage = {
    id: string;
    seq: number;
    content: { t: string; c?: string };
    localId: string | null;
    createdAt: number;
    updatedAt: number;
};

// Session message sequence numbers are stored as PostgreSQL INT values.
const MAX_MESSAGE_SEQUENCE = 2_147_483_647;

export class MessagesResourceImpl implements MessagesResource {
    constructor(
        private readonly transport: PawsHttpTransport,
        private readonly sessions: SessionsResourceImpl,
        private readonly encryption: RecordEncryptionStore,
    ) {}

    async history(sessionId: string, options: { limit?: number } = {}): Promise<Message[]> {
        const recordEncryption = await this.getEncryption(sessionId);
        const limit = options.limit ?? 100;
        if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
            throw new PawsAgentError('INVALID_ARGUMENT', 'limit must be between 1 and 500');
        }
        const response = await this.transport.get<{ messages: RawMessage[] }>(
            `/v3/sessions/${encodeURIComponent(sessionId)}/messages?before_seq=${MAX_MESSAGE_SEQUENCE}&limit=${limit}`,
        );
        return response.messages.map(raw => {
            if (raw.content.t !== 'encrypted' || typeof raw.content.c !== 'string') {
                throw new PawsAgentError('PROTOCOL_UNSUPPORTED', 'Unsupported message content');
            }
            return {
                id: raw.id,
                seq: raw.seq,
                content: decrypt(recordEncryption.key, recordEncryption.variant, decodeBase64(raw.content.c)),
                localId: raw.localId,
                createdAt: raw.createdAt,
                updatedAt: raw.updatedAt,
            } satisfies Message;
        }).sort((a, b) => a.createdAt - b.createdAt);
    }

    async send(input: SendMessageInput): Promise<SendMessageReceipt> {
        if (!input.sessionId.trim()) {
            throw new PawsAgentError('INVALID_ARGUMENT', 'sessionId is required');
        }
        const images = snapshotImages(input.images);
        const checkCancelled = () => {
            if (input.signal?.aborted) throw new PawsAgentError('CONNECTION_LOST', 'Message send cancelled');
        };
        checkCancelled();
        const session = await this.sessions.get(input.sessionId);
        checkCancelled();
        const metadata = session.metadata as { lifecycleState?: unknown } | null;
        if (!session.active || metadata?.lifecycleState === 'archived') {
            throw new PawsAgentError('SESSION_ARCHIVED', 'Session is archived', {
                details: { sessionId: input.sessionId },
            });
        }
        const recordEncryption = await this.getEncryption(input.sessionId);
        const localId = input.localId ?? globalThis.crypto.randomUUID();
        const batch: { localId: string; content: string }[] = [];
        for (const [index, image] of images.entries()) {
            checkCancelled();
            const bytes = encryptImage(image.bytes, recordEncryption);
            const descriptor = await this.transport.post<unknown>(
                `/v1/sessions/${encodeURIComponent(input.sessionId)}/attachments/request-upload`,
                { filename: image.name, size: bytes.length }, { signal: input.signal },
            );
            const ref = await this.transport.uploadAttachment(descriptor, bytes, { signal: input.signal });
            checkCancelled();
            const fileLocalId = `${localId}:image:${index}`;
            const file = {
                role: 'session',
                content: { type: 'session', data: {
                    id: fileLocalId, time: Date.now(), role: 'user',
                    ev: { t: 'file', ref, name: image.name, size: image.bytes.length, mimeType: image.mimeType,
                        ...(image.width !== undefined ? { image: { width: image.width, height: image.height } } : {}),
                    },
                } },
            };
            batch.push({ localId: fileLocalId, content: encodeBase64(encrypt(recordEncryption.key, recordEncryption.variant, file)) });
        }
        const content = {
            role: 'user',
            content: { type: 'text', text: input.text },
            meta: { sentFrom: 'paws-agent', ...input.meta },
        };
        // CLI 在收到 user/text 时领取之前的附件；仅图片也必须保留空正文。
        batch.push({ localId, content: encodeBase64(encrypt(recordEncryption.key, recordEncryption.variant, content)) });
        checkCancelled();
        await this.transport.post(
            `/v3/sessions/${encodeURIComponent(input.sessionId)}/messages`,
            {
                messages: batch,
            },
            { signal: input.signal },
        );
        return { sessionId: input.sessionId, localId };
    }

    private async getEncryption(sessionId: string) {
        let encryption = this.encryption.getSession(sessionId);
        if (!encryption) {
            await this.sessions.get(sessionId);
            encryption = this.encryption.getSession(sessionId);
        }
        if (!encryption) {
            throw new PawsAgentError('DECRYPTION_FAILED', 'Session encryption is unavailable');
        }
        return encryption;
    }
}
