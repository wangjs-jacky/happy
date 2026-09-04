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
    connectionNonce: z.string().min(1).max(256).optional(),
}).strict();

export type VercelCredential = z.infer<typeof vercelCredentialSchema>;

interface CredentialRepository {
    find: (accountId: string, key: string) => Promise<Uint8Array<ArrayBuffer> | null>;
    upsert: (accountId: string, key: string, value: Uint8Array<ArrayBuffer>) => Promise<void>;
    compareAndSet: (accountId: string, key: string, expected: Uint8Array<ArrayBuffer>, value: Uint8Array<ArrayBuffer>) => Promise<boolean>;
    createIfAbsent?: (accountId: string, key: string, value: Uint8Array<ArrayBuffer>) => Promise<boolean>;
    deleteIfCurrent?: (accountId: string, key: string, expected: Uint8Array<ArrayBuffer>) => Promise<boolean>;
    delete: (accountId: string, key: string) => Promise<void>;
}

interface Dependencies {
    repository: CredentialRepository;
    encrypt: (path: string[], value: string) => Uint8Array<ArrayBuffer>;
    decrypt: (path: string[], value: Uint8Array<ArrayBuffer>) => string;
}

const STORAGE_KEY = 'provider:vercel';
const PENDING_STORAGE_KEY_PREFIX = `${STORAGE_KEY}:pending:`;

export function pendingVercelCredentialStorageKey(connectionEpoch: number, connectionNonce: string): string {
    if (!Number.isInteger(connectionEpoch) || connectionEpoch < 0) throw new Error('Invalid Vercel connection epoch');
    if (!connectionNonce || connectionNonce.length > 256 || /[^A-Za-z0-9_-]/.test(connectionNonce)) throw new Error('Invalid Vercel connection nonce');
    return `${PENDING_STORAGE_KEY_PREFIX}${connectionEpoch}:${connectionNonce}`;
}

function encryptionPath(accountId: string): string[] {
    return ['user', accountId, 'providers', 'vercel', 'credential'];
}

export function createVercelCredentialStore(dependencies: Dependencies) {
    const parseEncrypted = (accountId: string, encrypted: Uint8Array<ArrayBuffer>): VercelCredential =>
        vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
    const matchesConnection = (credential: VercelCredential, connectionEpoch: number, connectionNonce: string): boolean =>
        credential.connectionEpoch === connectionEpoch && credential.connectionNonce === connectionNonce;
    const deletePendingInTransaction = async (transaction: any, accountId: string, connectionEpoch: number, connectionNonce: string): Promise<boolean> => {
        const vendor = pendingVercelCredentialStorageKey(connectionEpoch, connectionNonce);
        const pending = await transaction.serviceAccountToken.findUnique({
            where: { accountId_vendor: { accountId, vendor } }, select: { token: true },
        });
        if (!pending) return false;
        if (!matchesConnection(parseEncrypted(accountId, pending.token), connectionEpoch, connectionNonce)) return false;
        const removed = await transaction.serviceAccountToken.deleteMany({ where: { accountId, vendor, token: pending.token } });
        if (removed.count !== 1) throw new Error('Vercel pending credential changed during transactional cleanup');
        return true;
    };
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
        async replaceAtConnectionVersion(accountId: string, connectionEpoch: number, connectionNonce: string, replacement: VercelCredential): Promise<boolean> {
            const replacementValue = vercelCredentialSchema.parse({ ...replacement, connectionEpoch, connectionNonce });
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
        async replaceAtConnectionEpoch(accountId: string, connectionEpoch: number, replacement: VercelCredential): Promise<boolean> {
            return this.replaceAtConnectionVersion(accountId, connectionEpoch, `legacy-${connectionEpoch}`, replacement);
        },
        async stageConnectionReplacement(accountId: string, connectionEpoch: number, connectionNonce: string, replacement: VercelCredential): Promise<void> {
            const value = vercelCredentialSchema.parse({ ...replacement, connectionEpoch, connectionNonce });
            await dependencies.repository.upsert(
                accountId,
                pendingVercelCredentialStorageKey(connectionEpoch, connectionNonce),
                dependencies.encrypt(encryptionPath(accountId), JSON.stringify(value)),
            );
        },
        async deletePendingConnectionReplacement(accountId: string, connectionEpoch: number, connectionNonce: string): Promise<boolean> {
            const vendor = pendingVercelCredentialStorageKey(connectionEpoch, connectionNonce);
            const encrypted = await dependencies.repository.find(accountId, vendor);
            if (!encrypted || !matchesConnection(parseEncrypted(accountId, encrypted), connectionEpoch, connectionNonce)) return false;
            return Boolean(await dependencies.repository.deleteIfCurrent?.(accountId, vendor, encrypted));
        },
        async deletePendingConnectionReplacementInTransaction(transaction: any, accountId: string, connectionEpoch: number, connectionNonce: string): Promise<boolean> {
            return deletePendingInTransaction(transaction, accountId, connectionEpoch, connectionNonce);
        },
        async activatePendingConnectionReplacementInTransaction(transaction: any, accountId: string, connectionEpoch: number, connectionNonce: string): Promise<boolean> {
            const vendor = pendingVercelCredentialStorageKey(connectionEpoch, connectionNonce);
            const pending = await transaction.serviceAccountToken.findUnique({
                where: { accountId_vendor: { accountId, vendor } }, select: { token: true },
            });
            if (!pending || !matchesConnection(parseEncrypted(accountId, pending.token), connectionEpoch, connectionNonce)) return false;
            const account = await transaction.account.findUnique({ where: { id: accountId }, select: {
                vercelConnectionEpoch: true, vercelConnectionState: true, vercelConnectionNonce: true, vercelConnectionReplacementId: true,
            } });
            if (account?.vercelConnectionEpoch !== connectionEpoch || account.vercelConnectionState !== 'finalizing'
                || account.vercelConnectionNonce !== connectionNonce || account.vercelConnectionReplacementId !== connectionNonce) return false;
            const active = await transaction.serviceAccountToken.findUnique({
                where: { accountId_vendor: { accountId, vendor: STORAGE_KEY } }, select: { token: true },
            });
            if (active) {
                const replaced = await transaction.serviceAccountToken.updateMany({
                    where: { accountId, vendor: STORAGE_KEY, token: active.token }, data: { token: pending.token },
                });
                if (replaced.count !== 1) throw new Error('Vercel active credential changed during activation');
            } else {
                const created = await transaction.serviceAccountToken.createMany({
                    data: { accountId, vendor: STORAGE_KEY, token: pending.token }, skipDuplicates: true,
                });
                if (created.count !== 1) throw new Error('Vercel active credential appeared during activation');
            }
            const removed = await transaction.serviceAccountToken.deleteMany({ where: { accountId, vendor, token: pending.token } });
            if (removed.count !== 1) throw new Error('Vercel pending credential changed during activation');
            const activated = await transaction.account.updateMany({ where: {
                id: accountId, vercelConnectionEpoch: connectionEpoch, vercelConnectionState: 'finalizing',
                vercelConnectionNonce: connectionNonce, vercelConnectionReplacementId: connectionNonce,
            }, data: {
                vercelConnectionState: 'active', vercelConnectionReplacementId: null, vercelConnectionReplacementStartedAt: null,
            } });
            if (activated.count !== 1) throw new Error('Vercel connection changed during activation');
            return true;
        },
        async disconnectConnectionInTransaction(transaction: any, accountId: string, connectionEpoch: number, connectionNonce: string, expected: VercelCredential | null): Promise<boolean> {
            const account = await transaction.account.findUnique({ where: { id: accountId }, select: {
                vercelConnectionEpoch: true, vercelConnectionState: true, vercelConnectionNonce: true, vercelConnectionReplacementId: true,
            } });
            if (account?.vercelConnectionEpoch !== connectionEpoch || account.vercelConnectionState !== 'disconnecting'
                || account.vercelConnectionNonce !== connectionNonce || account.vercelConnectionReplacementId !== connectionNonce) return false;
            const active = await transaction.serviceAccountToken.findUnique({
                where: { accountId_vendor: { accountId, vendor: STORAGE_KEY } }, select: { token: true },
            });
            if (active) {
                if (!expected || JSON.stringify(parseEncrypted(accountId, active.token)) !== JSON.stringify(vercelCredentialSchema.parse(expected))) return false;
                const removed = await transaction.serviceAccountToken.deleteMany({ where: { accountId, vendor: STORAGE_KEY, token: active.token } });
                if (removed.count !== 1) throw new Error('Vercel active credential changed during disconnect');
            }
            await deletePendingInTransaction(transaction, accountId, connectionEpoch, connectionNonce);
            const disconnected = await transaction.account.updateMany({ where: {
                id: accountId, vercelConnectionEpoch: connectionEpoch, vercelConnectionState: 'disconnecting',
                vercelConnectionNonce: connectionNonce, vercelConnectionReplacementId: connectionNonce,
            }, data: { vercelConnectionState: 'disconnected', vercelConnectionReplacementId: null, vercelConnectionReplacementStartedAt: null } });
            if (disconnected.count !== 1) throw new Error('Vercel connection changed during disconnect');
            return true;
        },
        async deleteAtOrBeforeConnectionEpoch(accountId: string, connectionEpoch: number): Promise<boolean> {
            const encrypted = await dependencies.repository.find(accountId, STORAGE_KEY);
            if (!encrypted) return false;
            const current = vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
            if ((current.connectionEpoch ?? 0) > connectionEpoch) return false;
            return Boolean(await dependencies.repository.deleteIfCurrent?.(accountId, STORAGE_KEY, encrypted));
        },
        async deleteAtConnectionVersion(accountId: string, connectionEpoch: number, connectionNonce: string): Promise<boolean> {
            const encrypted = await dependencies.repository.find(accountId, STORAGE_KEY);
            if (!encrypted) return false;
            const current = vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
            if (current.connectionEpoch !== connectionEpoch || current.connectionNonce !== connectionNonce) return false;
            return Boolean(await dependencies.repository.deleteIfCurrent?.(accountId, STORAGE_KEY, encrypted));
        },
        async deleteIfCurrent(accountId: string, expected: VercelCredential): Promise<boolean> {
            const expectedValue = vercelCredentialSchema.parse(expected);
            const encrypted = await dependencies.repository.find(accountId, STORAGE_KEY);
            if (!encrypted) return false;
            const current = vercelCredentialSchema.parse(JSON.parse(dependencies.decrypt(encryptionPath(accountId), encrypted)));
            if (JSON.stringify(current) !== JSON.stringify(expectedValue)) return false;
            return Boolean(await dependencies.repository.deleteIfCurrent?.(accountId, STORAGE_KEY, encrypted));
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
        deleteMany: (args: unknown) => Promise<{ count: number }>;
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
        async deleteIfCurrent(accountId, vendor, token) {
            const result = await database.serviceAccountToken.deleteMany({
                where: { accountId, vendor, token },
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
