import { describe, expect, it, vi } from 'vitest';
import { Encryption } from './encryption';
import { EncryptionCache } from './encryptionCache';

vi.hoisted(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    (globalThis as unknown as { expo?: { EventEmitter: unknown } }).expo = {
        EventEmitter: EventTarget,
    };
});

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'test-uuid') }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createEncryptionForRouteTest() {
    const encryption = Object.create(Encryption.prototype) as any;
    encryption.sessionEncryptions = new Map();
    encryption.sessionBlobKeys = new Map();
    encryption.cache = new EncryptionCache();
    encryption.masterBlobKey = new Uint8Array([1, 2, 3]);
    encryption.openEncryption = vi.fn(async () => ({
        decrypt: vi.fn(async () => []),
        encrypt: vi.fn(async () => []),
    }));
    return encryption;
}

describe('route session encryption staging', () => {
    it('keeps encryption private while preparation is pending and until commit', async () => {
        const encryption = createEncryptionForRouteTest();
        const encryptor = deferred<{ decrypt: ReturnType<typeof vi.fn>; encrypt: ReturnType<typeof vi.fn> }>();
        encryption.openEncryption.mockReturnValue(encryptor.promise);

        const preparing = encryption.prepareSessionEncryption('session-1', null);
        expect(encryption.getSessionEncryption('session-1')).toBeNull();
        encryptor.resolve({
            decrypt: vi.fn(async () => []),
            encrypt: vi.fn(async () => []),
        });
        const prepared = await preparing;

        expect(encryption.getSessionEncryption('session-1')).toBeNull();
        expect(prepared.commit()).toBe(true);
        expect(encryption.getSessionEncryption('session-1')).not.toBeNull();
    });

    it('does not let an older staged commit overwrite a newer same-session commit', async () => {
        const encryption = createEncryptionForRouteTest();
        const older = await encryption.prepareSessionEncryption('session-1', null);
        const newer = await encryption.prepareSessionEncryption('session-1', null);

        expect(newer.commit()).toBe(true);
        const newerCommitted = encryption.getSessionEncryption('session-1');
        expect(older.commit()).toBe(false);

        expect(encryption.getSessionEncryption('session-1')).toBe(newerCommitted);
    });

    it('refuses an existing-encryption transaction after that encryption is replaced', async () => {
        const encryption = createEncryptionForRouteTest();
        const existing = { id: 'existing' };
        const replacement = { id: 'replacement' };
        encryption.sessionEncryptions.set('session-1', existing);
        const prepared = await encryption.prepareSessionEncryption('session-1', null);

        encryption.sessionEncryptions.set('session-1', replacement);

        expect(prepared.commit()).toBe(false);
        expect(encryption.getSessionEncryption('session-1')).toBe(replacement);
    });
});
