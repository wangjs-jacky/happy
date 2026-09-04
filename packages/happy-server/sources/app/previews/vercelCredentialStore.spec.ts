import { describe, expect, it, vi } from 'vitest';
import { createVercelCredentialStore } from './vercelCredentialStore';

describe('createVercelCredentialStore', () => {
    it('conditionally removes a stale crash credential without deleting a newer replacement', async () => {
        const encode = (value: unknown): Uint8Array<ArrayBuffer> => new TextEncoder().encode(JSON.stringify(value)) as Uint8Array<ArrayBuffer>;
        const decode = (value: Uint8Array) => new TextDecoder().decode(value);
        const stale = { version: 1 as const, accessToken: 'stale-secret', configurationId: 'icfg-stale', connectionEpoch: 4, connectionNonce: 'stale' };
        const newer = { version: 1 as const, accessToken: 'new-secret', configurationId: 'icfg-new', connectionEpoch: 5, connectionNonce: 'new' };
        let encrypted: Uint8Array<ArrayBuffer> | null = encode(stale);
        const deleteIfCurrent = vi.fn(async (_accountId, _key, expected) => {
            if (!encrypted || JSON.stringify(expected) !== JSON.stringify(encrypted)) return false;
            encrypted = null;
            return true;
        });
        const store = createVercelCredentialStore({
            repository: {
                find: vi.fn(async () => encrypted), upsert: vi.fn(), compareAndSet: vi.fn(), createIfAbsent: vi.fn(), deleteIfCurrent, delete: vi.fn(),
            },
            encrypt: (_path, value) => encode(JSON.parse(value)),
            decrypt: (_path, value) => decode(value),
        });

        await expect((store as any).deleteIfCurrent('account-1', stale)).resolves.toBe(true);
        encrypted = encode(newer);
        await expect((store as any).deleteIfCurrent('account-1', stale)).resolves.toBe(false);

        expect(JSON.parse(decode(encrypted))).toEqual(newer);
        expect(deleteIfCurrent).toHaveBeenCalledTimes(1);
    });

    it('does not let a stale callback overwrite a credential written at a newer connection epoch', async () => {
        const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
        const decode = (value: Uint8Array) => new TextDecoder().decode(value);
        let encrypted = encode({ version: 1, accessToken: 'old-secret', configurationId: 'cfg-old', connectionEpoch: 0 });
        const newer = { version: 1 as const, accessToken: 'newer-secret', configurationId: 'cfg-newer', connectionEpoch: 2 };
        let concurrentWrite = true;
        const store = createVercelCredentialStore({
            repository: {
                find: vi.fn(async () => encrypted), upsert: vi.fn(), delete: vi.fn(), createIfAbsent: vi.fn(),
                compareAndSet: vi.fn(async (_accountId, _key, _expected, value) => {
                    if (concurrentWrite) {
                        concurrentWrite = false;
                        encrypted = encode(newer);
                        return false;
                    }
                    encrypted = value;
                    return true;
                }),
            },
            encrypt: (_path, value) => encode(JSON.parse(value)),
            decrypt: (_path, value) => decode(value),
        });

        await expect((store as any).replaceAtConnectionEpoch('account-1', 1, {
            version: 1, accessToken: 'stale-secret', configurationId: 'cfg-stale',
        })).resolves.toBe(false);

        expect(JSON.parse(decode(encrypted))).toEqual(newer);
    });

    it('does not let a delayed disconnect delete a credential activated at a newer epoch', async () => {
        const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
        const decode = (value: Uint8Array) => new TextDecoder().decode(value);
        let encrypted = encode({ version: 1, accessToken: 'old-secret', configurationId: 'cfg-old', connectionEpoch: 4, connectionNonce: 'old' });
        const repository = {
            find: vi.fn(async () => encrypted), upsert: vi.fn(), createIfAbsent: vi.fn(),
            compareAndSet: vi.fn(async (_accountId, _key, expected, replacement) => {
                if (JSON.stringify(expected) !== JSON.stringify(encrypted)) return false;
                encrypted = replacement;
                return true;
            }),
            delete: vi.fn(),
        };
        const store = createVercelCredentialStore({
            repository,
            encrypt: (_path, value) => encode(JSON.parse(value)),
            decrypt: (_path, value) => decode(value),
        });

        await expect((store as any).replaceAtConnectionVersion('account-1', 6, 'new', {
            version: 1, accessToken: 'new-secret', configurationId: 'cfg-new',
        })).resolves.toBe(true);
        await expect((store as any).deleteAtOrBeforeConnectionEpoch('account-1', 5)).resolves.toBe(false);

        expect(JSON.parse(decode(encrypted))).toMatchObject({ accessToken: 'new-secret', connectionEpoch: 6, connectionNonce: 'new' });
        expect(repository.delete).not.toHaveBeenCalled();
    });

    it('atomically updates only projectId when the encrypted credential snapshot is still current', async () => {
        const encrypted = new Uint8Array([7, 7, 7]);
        const compareAndSet = vi.fn(async () => false);
        const encrypt = vi.fn(() => new Uint8Array([8, 8, 8]));
        const store = createVercelCredentialStore({
            repository: { find: vi.fn(async () => encrypted), upsert: vi.fn(), delete: vi.fn(), compareAndSet },
            encrypt,
            decrypt: vi.fn(() => JSON.stringify({ version: 1, accessToken: 'token-a', configurationId: 'icfg_1', teamId: 'team_1' })),
        });

        await expect((store as any).setProjectIdIfCurrent('account-1', {
            version: 1, accessToken: 'token-a', configurationId: 'icfg_1', teamId: 'team_1',
        }, 'prj_happy')).resolves.toBe(false);
        expect(encrypt).toHaveBeenCalledWith(
            ['user', 'account-1', 'providers', 'vercel', 'credential'],
            JSON.stringify({ version: 1, accessToken: 'token-a', configurationId: 'icfg_1', teamId: 'team_1', projectId: 'prj_happy' }),
        );
        expect(compareAndSet).toHaveBeenCalledWith('account-1', 'provider:vercel', encrypted, new Uint8Array([8, 8, 8]));
    });

    it.each([
        ['disconnect', null, null],
        ['changed token', new Uint8Array([4]), { version: 1, accessToken: 'token-b', configurationId: 'icfg_1', teamId: 'team_1' }],
        ['changed team scope', new Uint8Array([5]), { version: 1, accessToken: 'token-a', configurationId: 'icfg_1', teamId: 'team_2' }],
        ['changed configuration scope', new Uint8Array([6]), { version: 1, accessToken: 'token-a', configurationId: 'icfg_2', teamId: 'team_1' }],
    ])('does not resurrect a %s connection while persisting projectId', async (_race, encrypted, current) => {
        const compareAndSet = vi.fn(async () => true);
        const store = createVercelCredentialStore({
            repository: { find: vi.fn(async () => encrypted), upsert: vi.fn(), delete: vi.fn(), compareAndSet },
            encrypt: vi.fn(),
            decrypt: vi.fn(() => JSON.stringify(current)),
        });

        await expect((store as any).setProjectIdIfCurrent('account-1', {
            version: 1, accessToken: 'token-a', configurationId: 'icfg_1', teamId: 'team_1',
        }, 'prj_happy')).resolves.toBe(false);
        expect(compareAndSet).not.toHaveBeenCalled();
    });

    it('encrypts the complete credential with an account-scoped provider path', async () => {
        const upsert = vi.fn(async () => undefined);
        const encrypt = vi.fn(() => new Uint8Array([1, 2, 3]));
        const store = createVercelCredentialStore({
            repository: { find: vi.fn(async () => null), upsert, delete: vi.fn(async () => undefined), compareAndSet: vi.fn() },
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
            repository: { find: vi.fn(async () => encrypted), upsert: vi.fn(async () => undefined), delete: remove, compareAndSet: vi.fn() },
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
            repository: { find: vi.fn(async () => new Uint8Array([1])), upsert: vi.fn(), delete: vi.fn(), compareAndSet: vi.fn() },
            encrypt: vi.fn(),
            decrypt: vi.fn(() => JSON.stringify({ version: 1, accessToken: '', configurationId: 'x', extra: true })),
        });
        await expect(store.get('account-3')).rejects.toThrow();
    });
});
