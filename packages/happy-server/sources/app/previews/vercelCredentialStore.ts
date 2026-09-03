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
}).strict();

export type VercelCredential = z.infer<typeof vercelCredentialSchema>;

interface CredentialRepository {
    find: (accountId: string, key: string) => Promise<Uint8Array<ArrayBuffer> | null>;
    upsert: (accountId: string, key: string, value: Uint8Array<ArrayBuffer>) => Promise<void>;
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
        async delete(accountId: string): Promise<void> {
            await dependencies.repository.delete(accountId, STORAGE_KEY);
        },
    };
}

interface ServiceAccountDatabase {
    serviceAccountToken: {
        findUnique: (args: unknown) => Promise<{ token: Uint8Array<ArrayBuffer> } | null>;
        upsert: (args: unknown) => Promise<unknown>;
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
