import { describe, expect, it, vi } from 'vitest';
import type { ApiSessionSnapshot } from './apiTypes';
import type { Encryption } from './encryption/encryption';
import { hydrateSessionSnapshots } from './sessionSnapshotHydration';

const snapshot: ApiSessionSnapshot = {
    id: 'session-1',
    seq: 7,
    metadata: 'metadata',
    metadataVersion: 2,
    agentState: 'agent-state',
    agentStateVersion: 3,
    dataEncryptionKey: 'encrypted-data-key',
    active: true,
    activeAt: 100,
    createdAt: 90,
    updatedAt: 100,
    lastMessage: null,
};

function createEncryption() {
    const decryptedKey = new Uint8Array([1, 2, 3]);
    let initialized = false;
    const sessionEncryption = {
        decryptMetadata: vi.fn(async (version: number, encrypted: string) => {
            if (!initialized) throw new Error('metadata decrypted before session initialization');
            return { title: `${encrypted}-${version}` };
        }),
        decryptAgentState: vi.fn(async (version: number, encrypted: string | null) => {
            if (!initialized) throw new Error('agent state decrypted before session initialization');
            return encrypted ? { state: `${encrypted}-${version}` } : null;
        }),
    };
    const encryption = {
        decryptEncryptionKey: vi.fn(async () => decryptedKey),
        initializeSessions: vi.fn(async () => {
            initialized = true;
        }),
        getSessionEncryption: vi.fn(() => sessionEncryption),
    } as unknown as Encryption;

    return { encryption, decryptedKey, sessionEncryption };
}

describe('hydrateSessionSnapshots', () => {
    it('hydrates exactly the supplied snapshots after initializing their keys', async () => {
        const { encryption, decryptedKey, sessionEncryption } = createEncryption();

        const result = await hydrateSessionSnapshots([snapshot], encryption);

        expect(encryption.decryptEncryptionKey).toHaveBeenCalledTimes(1);
        expect(encryption.initializeSessions).toHaveBeenCalledWith(
            new Map([['session-1', decryptedKey]]),
        );
        expect(sessionEncryption.decryptMetadata).toHaveBeenCalledWith(2, 'metadata');
        expect(sessionEncryption.decryptAgentState).toHaveBeenCalledWith(3, 'agent-state');
        expect(result).toEqual([
            expect.objectContaining({
                id: 'session-1',
                metadata: { title: 'metadata-2' },
                agentState: { state: 'agent-state-3' },
                thinking: false,
                thinkingAt: 0,
            }),
        ]);
    });

    it('skips only the snapshot whose data key cannot be decrypted', async () => {
        const { encryption } = createEncryption();
        const logger = { warn: vi.fn() };
        encryption.decryptEncryptionKey = vi.fn(async (encryptedKey: string) => (
            encryptedKey === 'bad-data-key' ? null : new Uint8Array([4, 5, 6])
        ));
        const validSnapshot = { ...snapshot, id: 'session-2', dataEncryptionKey: 'valid-data-key' };
        const invalidSnapshot = { ...snapshot, id: 'session-3', dataEncryptionKey: 'bad-data-key' };

        const result = await hydrateSessionSnapshots([validSnapshot, invalidSnapshot], encryption, logger);

        expect(result.map((session) => session.id)).toEqual(['session-2']);
        expect(logger.warn).toHaveBeenCalledWith('Skipping session snapshot because its data key could not be decrypted');
    });
});
