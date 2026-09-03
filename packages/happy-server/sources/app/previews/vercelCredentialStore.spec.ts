import { describe, expect, it, vi } from 'vitest';
import { createVercelCredentialStore } from './vercelCredentialStore';

describe('createVercelCredentialStore', () => {
    it('encrypts the complete credential with an account-scoped provider path', async () => {
        const upsert = vi.fn(async () => undefined);
        const encrypt = vi.fn(() => new Uint8Array([1, 2, 3]));
        const store = createVercelCredentialStore({
            repository: { find: vi.fn(async () => null), upsert, delete: vi.fn(async () => undefined) },
            encrypt,
            decrypt: vi.fn(),
        });

        await store.set('account-1', {
            version: 1,
            accessToken: 'secret-token',
            configurationId: 'icfg_123',
            teamId: 'team_123',
            teamName: 'Paws',
        });

        expect(encrypt).toHaveBeenCalledWith(
            ['user', 'account-1', 'providers', 'vercel', 'credential'],
            JSON.stringify({
                version: 1,
                accessToken: 'secret-token',
                configurationId: 'icfg_123',
                teamId: 'team_123',
                teamName: 'Paws',
            }),
        );
        expect(upsert).toHaveBeenCalledWith('account-1', 'provider:vercel', new Uint8Array([1, 2, 3]));
    });

    it('decrypts, validates, and deletes provider credentials', async () => {
        const encrypted = new Uint8Array([3, 2, 1]);
        const remove = vi.fn(async () => undefined);
        const decrypt = vi.fn(() => JSON.stringify({
            version: 1,
            accessToken: 'secret-token',
            configurationId: 'icfg_456',
        }));
        const store = createVercelCredentialStore({
            repository: { find: vi.fn(async () => encrypted), upsert: vi.fn(async () => undefined), delete: remove },
            encrypt: vi.fn(),
            decrypt,
        });

        await expect(store.get('account-2')).resolves.toEqual({
            version: 1,
            accessToken: 'secret-token',
            configurationId: 'icfg_456',
        });
        expect(decrypt).toHaveBeenCalledWith(
            ['user', 'account-2', 'providers', 'vercel', 'credential'],
            encrypted,
        );
        await store.delete('account-2');
        expect(remove).toHaveBeenCalledWith('account-2', 'provider:vercel');
    });

    it('fails closed for malformed decrypted records', async () => {
        const store = createVercelCredentialStore({
            repository: { find: vi.fn(async () => new Uint8Array([1])), upsert: vi.fn(), delete: vi.fn() },
            encrypt: vi.fn(),
            decrypt: vi.fn(() => JSON.stringify({ version: 1, accessToken: '', configurationId: 'x', extra: true })),
        });
        await expect(store.get('account-3')).rejects.toThrow();
    });
});
