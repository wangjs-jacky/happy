import { z } from 'zod';
import { decryptString, encryptString } from '@/modules/encrypt';
import { db } from '@/storage/db';

export const vercelCredentialSchema = z.object({
    version: z.literal(1),
    accessToken: z.string().min(1).max(4096),
    configurationId: z.string().min(1).max(256),
    teamId: z.string().min(1).max(256).optional(),
    teamName: z.string().min(1).max(256).optional(),
    projectId: z.string().min(1).max(256).optional(),
    connectionEpoch: z.number().int().nonnegative().optional(),
}).strict();

export type VercelCredential = z.infer<typeof vercelCredentialSchema>;

interface CredentialRepository {
    find: (accountId: string, key: string) => Promise<Uint8Array<ArrayBuffer> | null>;
    upsert: (accountId: string, key: string, value: Uint8Array<ArrayBuffer>) => Promise<void>;
    compareAndSet: (accountId: string, key: string, expected: Uint8Array<ArrayBuffer>, value: Uint8Array<ArrayBuffer>) => Promise<boolean>;
    createIfAbsent?: (accountId: string, key: string, value: Uint8Array<ArrayBuffer>) => Promise<boolean>;
    delete: (accountId: string, key: string) => Promise<void>;
}

interface Dependencies {
    repository: CredentialRepository;
    encrypt: (path: string[], value: string) => Uint8Array<ArrayBuffer>;
    decrypt: (path: string[], value: Uint8Array<ArrayBuffer>) => string;
}

const STORAGE_KEY = 'provider:vercel';

function encryptionPath(accountId: string): string[] {
    return ['user', accountId, 'providers', 'vercel', 'credential'];
}

export function createVercelCredentialStore(dependencies: Dependencies) {
    return {
        async set(accountId: string, credential: VercelCredential): Promise<void> {
            const value = vercelCredentialSchema.parse(credential);
            const encrypted = dependencies.encrypt(encryptionPath(accountId), JSON.stringify(value));
            await dependencies.repository.upsert(accountId, STORAGE_KEY, encrypted);
        },
        async get(accountId: string): Promise<VercelCredential | null> {
            const encrypted = await dependencies.repository.find(accountId, STORAGE_KEY);
            if (!encrypted) return null;
            return vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
        },
        async setProjectIdIfCurrent(accountId: string, expected: VercelCredential, projectId: string): Promise<boolean> {
            const encrypted = await dependencies.repository.find(accountId, STORAGE_KEY);
            if (!encrypted) return false;
            const current = vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
            if (JSON.stringify(current) !== JSON.stringify(vercelCredentialSchema.parse(expected))) return false;
            const replacement = vercelCredentialSchema.parse({ ...current, projectId });
            return dependencies.repository.compareAndSet(accountId, STORAGE_KEY, encrypted, dependencies.encrypt(encryptionPath(accountId), JSON.stringify(replacement)));
        },
        async replaceIfCurrent(accountId: string, expected: VercelCredential | null, replacement: VercelCredential): Promise<boolean> {
            const expectedValue = expected === null ? null : vercelCredentialSchema.parse(expected);
            const replacementValue = vercelCredentialSchema.parse(replacement);
            const encrypted = await dependencies.repository.find(accountId, STORAGE_KEY);
            if (!encrypted) {
                if (expectedValue !== null) return false;
                return Boolean(await dependencies.repository.createIfAbsent?.(
                    accountId, STORAGE_KEY, dependencies.encrypt(encryptionPath(accountId), JSON.stringify(replacementValue)),
                ));
            }
            if (!expectedValue) return false;
            const current = vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
            if (JSON.stringify(current) !== JSON.stringify(expectedValue)) return false;
            return dependencies.repository.compareAndSet(
                accountId, STORAGE_KEY, encrypted, dependencies.encrypt(encryptionPath(accountId), JSON.stringify(replacementValue)),
            );
        },
        async replaceAtConnectionEpoch(accountId: string, connectionEpoch: number, replacement: VercelCredential): Promise<boolean> {
            const replacementValue = vercelCredentialSchema.parse({ ...replacement, connectionEpoch });
            for (let attempt = 0; attempt < 3; attempt++) {
                const encrypted = await dependencies.repository.find(accountId, STORAGE_KEY);
                if (!encrypted) {
                    if (await dependencies.repository.createIfAbsent?.(
                        accountId, STORAGE_KEY, dependencies.encrypt(encryptionPath(accountId), JSON.stringify(replacementValue)),
                    )) return true;
                    continue;
                }
                const current = vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
                if ((current.connectionEpoch ?? 0) >= connectionEpoch) return false;
                if (await dependencies.repository.compareAndSet(
                    accountId, STORAGE_KEY, encrypted, dependencies.encrypt(encryptionPath(accountId), JSON.stringify(replacementValue)),
                )) return true;
            }
            return false;
        },
        async delete(accountId: string): Promise<void> {
            await dependencies.repository.delete(accountId, STORAGE_KEY);
        },
    };
}

interface ServiceAccountDatabase {
    serviceAccountToken: {
        findUnique: (args: unknown) => Promise<{ token: Uint8Array<ArrayBuffer> } | null>;
        upsert: (args: unknown) => Promise<unknown>;
        updateMany: (args: unknown) => Promise<{ count: number }>;
        createMany: (args: unknown) => Promise<{ count: number }>;
        deleteMany: (args: unknown) => Promise<unknown>;
    };
}

export function createVercelCredentialRepository(database: ServiceAccountDatabase): CredentialRepository {
    return {
        async find(accountId, vendor) {
            const row = await database.serviceAccountToken.findUnique({
                where: { accountId_vendor: { accountId, vendor } },
                select: { token: true },
            });
            return row?.token ?? null;
        },
        async upsert(accountId, vendor, token) {
            await database.serviceAccountToken.upsert({
                where: { accountId_vendor: { accountId, vendor } },
                update: { token },
                create: { accountId, vendor, token },
            });
        },
        async compareAndSet(accountId, vendor, expected, token) {
            const result = await database.serviceAccountToken.updateMany({
                where: { accountId, vendor, token: expected }, data: { token },
            });
            return result.count === 1;
        },
        async createIfAbsent(accountId, vendor, token) {
            const result = await database.serviceAccountToken.createMany({
                data: { accountId, vendor, token }, skipDuplicates: true,
            });
            return result.count === 1;
        },
        async delete(accountId, vendor) {
            await database.serviceAccountToken.deleteMany({ where: { accountId, vendor } });
        },
    };
}

export const vercelCredentialStore = createVercelCredentialStore({
    repository: createVercelCredentialRepository(db as unknown as ServiceAccountDatabase),
    encrypt: encryptString,
    decrypt: decryptString,
});
