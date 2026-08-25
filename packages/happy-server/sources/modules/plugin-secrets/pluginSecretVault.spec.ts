import { describe, expect, it, vi } from 'vitest';

import {
    createPluginSecretVault,
    createServiceAccountTokenPluginSecretRepository,
} from './pluginSecretVault';

describe('createPluginSecretVault', () => {
    it('encrypts a plugin secret with a user-scoped path before persisting it', async () => {
        const upsert = vi.fn(async () => undefined);
        const encrypt = vi.fn(() => new Uint8Array([7, 8, 9]));
        const vault = createPluginSecretVault({
            repository: {
                find: vi.fn(async () => null),
                upsert,
                delete: vi.fn(async () => undefined),
            },
            encrypt,
            decrypt: vi.fn(),
        });

        await vault.set('user-1', 'relationship-advisor', 'api-key-value');

        expect(encrypt).toHaveBeenCalledWith(
            ['user', 'user-1', 'plugins', 'relationship-advisor', 'secret'],
            'api-key-value',
        );
        expect(upsert).toHaveBeenCalledWith(
            'user-1',
            'plugin:relationship-advisor',
            new Uint8Array([7, 8, 9]),
        );
    });

    it('decrypts an existing secret with the same scoped path', async () => {
        const encrypted = new Uint8Array([3, 2, 1]);
        const decrypt = vi.fn(() => 'stored-secret');
        const vault = createPluginSecretVault({
            repository: {
                find: vi.fn(async () => encrypted),
                upsert: vi.fn(async () => undefined),
                delete: vi.fn(async () => undefined),
            },
            encrypt: vi.fn(),
            decrypt,
        });

        await expect(vault.get('user-2', 'relationship-advisor')).resolves.toBe('stored-secret');
        expect(decrypt).toHaveBeenCalledWith(
            ['user', 'user-2', 'plugins', 'relationship-advisor', 'secret'],
            encrypted,
        );
    });

    it('returns null for a missing secret and deletes only the selected plugin record', async () => {
        const repository = {
            find: vi.fn(async () => null),
            upsert: vi.fn(async () => undefined),
            delete: vi.fn(async () => undefined),
        };
        const vault = createPluginSecretVault({
            repository,
            encrypt: vi.fn(),
            decrypt: vi.fn(),
        });

        await expect(vault.get('user-3', 'relationship-advisor')).resolves.toBeNull();
        await vault.delete('user-3', 'relationship-advisor');

        expect(repository.delete).toHaveBeenCalledWith('user-3', 'plugin:relationship-advisor');
    });
});

describe('createServiceAccountTokenPluginSecretRepository', () => {
    it('persists ciphertext in the existing per-user service token record', async () => {
        const serviceAccountToken = {
            findUnique: vi.fn(async () => ({ token: new Uint8Array([1, 4]) })),
            upsert: vi.fn(async () => undefined),
            deleteMany: vi.fn(async () => ({ count: 1 })),
        };
        const repository = createServiceAccountTokenPluginSecretRepository({ serviceAccountToken });

        await expect(repository.find('user-1', 'plugin:relationship-advisor'))
            .resolves.toEqual(new Uint8Array([1, 4]));
        await repository.upsert('user-1', 'plugin:relationship-advisor', new Uint8Array([2, 5]));
        await repository.delete('user-1', 'plugin:relationship-advisor');

        expect(serviceAccountToken.upsert).toHaveBeenCalledWith({
            where: { accountId_vendor: { accountId: 'user-1', vendor: 'plugin:relationship-advisor' } },
            update: { token: new Uint8Array([2, 5]) },
            create: {
                accountId: 'user-1',
                vendor: 'plugin:relationship-advisor',
                token: new Uint8Array([2, 5]),
            },
        });
        expect(serviceAccountToken.deleteMany).toHaveBeenCalledWith({
            where: { accountId: 'user-1', vendor: 'plugin:relationship-advisor' },
        });
    });
});
