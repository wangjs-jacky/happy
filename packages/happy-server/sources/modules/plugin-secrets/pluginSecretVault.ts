import { decryptString, encryptString } from '@/modules/encrypt';
import { db } from '@/storage/db';

export interface PluginSecretRepository {
    find: (accountId: string, storageKey: string) => Promise<Uint8Array<ArrayBuffer> | null>;
    upsert: (accountId: string, storageKey: string, encrypted: Uint8Array<ArrayBuffer>) => Promise<void>;
    delete: (accountId: string, storageKey: string) => Promise<void>;
}

export interface PluginSecretVaultDependencies {
    repository: PluginSecretRepository;
    encrypt: (path: string[], value: string) => Uint8Array<ArrayBuffer>;
    decrypt: (path: string[], encrypted: Uint8Array<ArrayBuffer>) => string;
}

interface ServiceAccountTokenStore {
    serviceAccountToken: {
        findUnique: (args: unknown) => Promise<{ token: Uint8Array<ArrayBuffer> } | null>;
        upsert: (args: unknown) => Promise<unknown>;
        deleteMany: (args: unknown) => Promise<unknown>;
    };
}

function storageKey(pluginId: string): string {
    return `plugin:${pluginId}`;
}

function encryptionPath(accountId: string, pluginId: string): string[] {
    return ['user', accountId, 'plugins', pluginId, 'secret'];
}

export function createPluginSecretVault(dependencies: PluginSecretVaultDependencies) {
    return {
        async set(accountId: string, pluginId: string, value: string): Promise<void> {
            const encrypted = dependencies.encrypt(encryptionPath(accountId, pluginId), value);
            await dependencies.repository.upsert(accountId, storageKey(pluginId), encrypted);
        },
        async get(accountId: string, pluginId: string): Promise<string | null> {
            const encrypted = await dependencies.repository.find(accountId, storageKey(pluginId));
            return encrypted
                ? dependencies.decrypt(encryptionPath(accountId, pluginId), encrypted)
                : null;
        },
        async delete(accountId: string, pluginId: string): Promise<void> {
            await dependencies.repository.delete(accountId, storageKey(pluginId));
        },
    };
}

export function createServiceAccountTokenPluginSecretRepository(
    database: ServiceAccountTokenStore,
): PluginSecretRepository {
    return {
        async find(accountId, key) {
            const record = await database.serviceAccountToken.findUnique({
                where: { accountId_vendor: { accountId, vendor: key } },
                select: { token: true },
            });
            return record?.token ?? null;
        },
        async upsert(accountId, key, encrypted) {
            await database.serviceAccountToken.upsert({
                where: { accountId_vendor: { accountId, vendor: key } },
                update: { token: encrypted },
                create: { accountId, vendor: key, token: encrypted },
            });
        },
        async delete(accountId, key) {
            await database.serviceAccountToken.deleteMany({
                where: { accountId, vendor: key },
            });
        },
    };
}

export const pluginSecretVault = createPluginSecretVault({
    repository: createServiceAccountTokenPluginSecretRepository(db as unknown as ServiceAccountTokenStore),
    encrypt: encryptString,
    decrypt: decryptString,
});
