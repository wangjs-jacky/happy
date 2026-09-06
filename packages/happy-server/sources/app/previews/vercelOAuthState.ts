import { createHash, randomBytes } from 'node:crypto';
import { db } from '@/storage/db';

interface StateDatabase {
    repeatKey: {
        upsert: (args: unknown) => Promise<unknown>;
        findUnique: (args: unknown) => Promise<{ value: string; expiresAt: Date } | null>;
        deleteMany: (args: unknown) => Promise<{ count: number }>;
    };
    $transaction?: <T>(fn: (tx: StateDatabase) => Promise<T>) => Promise<T>;
}

const STATE_TTL_MS = 5 * 60 * 1000;

function stateKey(state: string): string {
    return `vercel-oauth:${createHash('sha256').update(state).digest('hex')}`;
}

export function createVercelOAuthStateStore(database: StateDatabase, now = () => new Date()) {
    return {
        async create(accountId: string): Promise<string> {
            const state = randomBytes(32).toString('base64url');
            const createdAt = now();
            await database.repeatKey.upsert({
                where: { key: stateKey(state) },
                create: { key: stateKey(state), value: accountId, expiresAt: new Date(createdAt.getTime() + STATE_TTL_MS) },
                update: { value: accountId, expiresAt: new Date(createdAt.getTime() + STATE_TTL_MS) },
            });
            return state;
        },
        async consume(state: string): Promise<string | null> {
            if (!/^[A-Za-z0-9_-]{40,64}$/.test(state)) return null;
            const consumeWith = async (databaseTx: StateDatabase) => {
                const key = stateKey(state);
                const row = await databaseTx.repeatKey.findUnique({ where: { key } });
                if (!row || row.expiresAt < now()) return null;
                const deleted = await databaseTx.repeatKey.deleteMany({ where: { key, expiresAt: { gte: now() } } });
                return deleted.count === 1 ? row.value : null;
            };
            return database.$transaction ? database.$transaction(consumeWith) : consumeWith(database);
        },
    };
}

export const vercelOAuthStateStore = createVercelOAuthStateStore(db as unknown as StateDatabase);
