import { describe, expect, it, vi } from 'vitest';
import { createVercelOAuthStateStore } from './vercelOAuthState';

describe('createVercelOAuthStateStore', () => {
    it('stores only a digest and consumes a state once', async () => {
        let row: { key: string; value: string; expiresAt: Date } | null = null;
        const repeatKey = {
            upsert: vi.fn(async (args: any) => { row = args.create; }),
            findUnique: vi.fn(async () => row),
            deleteMany: vi.fn(async () => { const count = row ? 1 : 0; row = null; return { count }; }),
        };
        const database: any = { repeatKey, $transaction: async (fn: any) => fn(database) };
        const store = createVercelOAuthStateStore(database, () => new Date('2026-09-04T00:00:00Z'));
        const state = await store.create('user-1');
        expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(repeatKey.upsert.mock.calls[0][0].create.key).not.toContain(state);
        expect(await store.consume(state)).toBe('user-1');
        expect(await store.consume(state)).toBeNull();
    });
});
