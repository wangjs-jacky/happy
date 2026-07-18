import type { DecryptedMessage } from './storageTypes';
import { type NormalizedMessage, normalizeRawMessage } from './typesRaw';

export function normalizeDecryptedMessage(
    decrypted: DecryptedMessage,
    sourceSeq: number,
): NormalizedMessage | null {
    return normalizeRawMessage(
        decrypted.id,
        decrypted.localId,
        decrypted.createdAt,
        decrypted.content,
        sourceSeq,
    );
}

export function normalizeDecryptedMessages(
    sourceMessages: ReadonlyArray<{ seq: number }>,
    decryptedMessages: ReadonlyArray<DecryptedMessage | null>,
): NormalizedMessage[] {
    const normalizedMessages: NormalizedMessage[] = [];
    for (let i = 0; i < decryptedMessages.length; i++) {
        const decrypted = decryptedMessages[i];
        const source = sourceMessages[i];
        if (!decrypted || !source) continue;
        const normalized = normalizeDecryptedMessage(decrypted, source.seq);
        if (normalized) normalizedMessages.push(normalized);
    }
    return normalizedMessages;
}
