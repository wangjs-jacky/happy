import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, expect, it, vi } from 'vitest';
import sodium from 'libsodium-wrappers';
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/encryption/libsodium.lib', () => ({ default: sodium }));
vi.mock('expo-crypto', () => ({ randomUUID, getRandomBytes: (length: number) => new Uint8Array(randomBytes(length)),
    CryptoDigestAlgorithm: { SHA256: 'sha256', SHA512: 'sha512' },
    digest: async (algorithm: string, data: Uint8Array) => new Uint8Array(createHash(algorithm).update(data).digest()).buffer }));
import { Encryption } from './encryption';
import { encryptBox } from '@/encryption/libsodium';
import { encodeBase64 } from '@/encryption/base64';
beforeAll(async () => { await sodium.ready; });
it.each([true, false])('opens the worker service envelope for a data-key machine=%s using the exact CLI derivation', async modern => {
    const master = new Uint8Array(32).fill(1), dataKey = modern ? new Uint8Array(32).fill(2) : null;
    const privateKey = createHash('sha256').update('paws-ai-services-machine-box/1\0').update(dataKey ?? master).digest();
    const publicKey = sodium.crypto_scalarmult_base(privateKey);
    const envelope = { protocol: 'ai-services/1', messageKey: 'fixture-only' };
    const ciphertext = encodeBase64(encryptBox(new TextEncoder().encode(JSON.stringify(envelope)), publicKey));
    const encryption = await Encryption.create(master);
    await encryption.initializeMachines(new Map([['device', dataKey]]));
    const machine = encryption.getMachineEncryption('device')!;
    expect(await machine.decryptServiceEnvelope(ciphertext)).toEqual(envelope);
    expect(await machine.decryptRaw(ciphertext)).toBeNull();
    expect(await machine.decryptServiceEnvelope('corrupt')).toBeNull();
    const other = await Encryption.create(new Uint8Array(32).fill(9));
    await other.initializeMachines(new Map([['device', modern ? new Uint8Array(32).fill(9) : null]]));
    expect(await other.getMachineEncryption('device')!.decryptServiceEnvelope(ciphertext)).toBeNull();
    encryption.removeMachineEncryption('device');
    expect(encryption.getMachineEncryption('device')).toBeNull();
});
