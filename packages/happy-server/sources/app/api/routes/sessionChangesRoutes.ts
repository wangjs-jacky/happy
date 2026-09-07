import { db } from '@/storage/db';
import { z } from 'zod';
import type { Fastify } from '../types';

const cursorSchema = z.object({
    v: z.literal(1), accountId: z.string(), revision: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
});

function encodeCursor(accountId: string, revision: bigint): string {
    return Buffer.from(JSON.stringify({ v: 1, accountId, revision: revision.toString() })).toString('base64url');
}

export function sessionChangesRoutes(app: Fastify) {
    app.get('/v3/sessions/changes', {
        preHandler: app.authenticate,
        schema: { querystring: z.object({
            cursor: z.string().max(2048).optional(),
            limit: z.coerce.number().int().min(1).max(500).default(200),
        }) },
    }, async (request, reply) => {
        const accountId = request.userId;
        const { cursor, limit } = request.query;
        let revision = 0n;
        if (cursor !== undefined) {
            try {
                const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
                if (parsed.accountId !== accountId) throw new Error('foreign cursor');
                revision = BigInt(parsed.revision);
            } catch {
                return reply.code(409).send({ error: 'reset-required' });
            }
            // Storage failures are normal server errors, not instructions to
            // reset a valid client cursor and repeat its entire reconciliation.
            const counter = await db.sessionChangeCounter.findUnique({ where: { accountId } });
            if (revision > (counter?.revision ?? 0n)) return reply.code(409).send({ error: 'reset-required' });
        }

        // Single statement snapshot, keyset ordered by commit-serialized revision.
        // A row updated during pagination moves forward and is replayed later.
        const rows = await db.sessionChange.findMany({
            where: { accountId, revision: { gt: revision } },
            orderBy: { revision: 'asc' }, take: limit + 1,
            select: { sessionId: true, revision: true, deleted: true, lastMessageSeq: true, metadataVersion: true, agentStateVersion: true },
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return reply.send({
            changes: page.map((row) => ({ ...row, revision: row.revision.toString() })),
            // Never use the current head: it can include rows this page didn't read.
            nextCursor: encodeCursor(accountId, page.at(-1)?.revision ?? revision),
            hasMore,
        });
    });
}
