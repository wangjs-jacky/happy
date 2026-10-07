import { Prisma } from '@prisma/client';
import { ExecutionBindingSchema, ServiceGrantScopeSchema, TurnActualSchema } from '@slopus/happy-wire';
import { inTx } from '@/storage/inTx';
import { delegatedApp, DelegationError } from '@/app/appDelegation/appDelegation';

const denied = (): never => { throw new DelegationError(403, 'History access unavailable; reopen the conversation from Paws'); };
const protocol = 'ai-services/1' as const;

/** Read-only expiry projection: viewing retained history never mutates worker state. */
function historyState(state: string, deadline: Date | null, leaseUntil: Date | null, shared: boolean) {
    const active = shared ? ['accepted', 'running', 'cancel-requested'] : ['queued', 'running'];
    const leased = shared ? ['running', 'cancel-requested'] : ['running'];
    if (active.includes(state) && ((deadline && deadline.getTime() <= Date.now()) ||
        (leased.includes(state) && (!leaseUntil || leaseUntil.getTime() <= Date.now())))) return shared ? 'interrupted' : 'failed';
    return state;
}

/** Owner directory metadata only; shadow rows must belong to the same owner as the authorization. */
export async function ownerAuthorizations(accountId: string) {
    return inTx(async tx => {
        const legacy = await tx.appDelegation.findMany({ where: { accountId, protocol: { lte: 3 } },
            select: { id: true, appId: true, machineId: true, state: true, expiresAt: true, createdAt: true } });
        const shadows = await tx.appDelegation.findMany({ where: { accountId, protocol: 4 }, select: { id: true, appId: true } });
        const grants = await tx.aIServiceAuthorization.findMany({ where: { ownerId: accountId, id: { in: shadows.map(row => row.id) } },
            select: { id: true, appId: true, scope: true, revokedAt: true, expiresAt: true, createdAt: true } });
        const shared = grants.filter(grant => shadows.some(row => row.id === grant.id && row.appId === grant.appId)).map(grant => {
            const scope = ServiceGrantScopeSchema.safeParse(grant.scope);
            return { id: grant.id, appId: grant.appId, machineId: scope.success ? scope.data.targets[0]?.machineId ?? null : null,
                state: grant.revokedAt ? 'revoked' : 'redeemed', expiresAt: grant.expiresAt, createdAt: grant.createdAt, protocol };
        });
        return { grants: [...legacy, ...shared].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)) };
    });
}

/** One bounded page across both protocols, with ownership and binding/grant fences before pagination. */
export async function ownerServiceConversations(accountId: string, cursor?: string) {
    return inTx(async tx => {
        const eligible = Prisma.sql`
            SELECT c."id", c."grantId", c."createdAt", g."protocol", b."snapshot"->>'machineId' AS "machineId",
                COALESCE(t."createdAt", c."createdAt") AS "lastActivityAt", t."state", t."deadline", t."leaseUntil"
            FROM "AppChatConversation" c
            JOIN "AppDelegation" g ON g."id" = c."grantId"
            LEFT JOIN "AIServiceBinding" b ON b."id" = c."id"
            LEFT JOIN "AIServiceAuthorization" a ON a."id" = b."authorizationId"
            LEFT JOIN LATERAL (
                SELECT "state", "createdAt", "deadline", "leaseUntil" FROM "AppChatTurn"
                WHERE "conversationId" = c."id" AND ((g."protocol" <= 3 AND "bindingId" IS NULL) OR "bindingId" = b."id")
                ORDER BY "createdAt" DESC, "id" DESC LIMIT 1
            ) t ON TRUE
            WHERE g."accountId" = ${accountId} AND (
                (g."protocol" <= 3 AND b."id" IS NULL) OR
                (g."protocol" = 4 AND b."ownerId" = ${accountId} AND a."ownerId" = ${accountId}
                    AND a."id" = c."grantId" AND b."appId" = a."appId" AND g."appId" = a."appId"
                    AND b."serviceId" = a."serviceId" AND b."snapshot"->>'id' = b."id"
                    AND b."snapshot"->>'appId' = b."appId" AND b."snapshot"->>'serviceId' = b."serviceId"
                    AND b."snapshot"->>'revision' = b."revision"::text AND jsonb_typeof(b."snapshot"->'machineId') = 'string')
            )`;
        type Row = { id: string; grantId: string; createdAt: Date; protocol: number; machineId: string | null; lastActivityAt: Date; state: string | null; deadline: Date | null; leaseUntil: Date | null };
        const anchor = cursor ? (await tx.$queryRaw<Row[]>(Prisma.sql`WITH eligible AS (${eligible}) SELECT * FROM eligible WHERE "id" = ${cursor}`))[0] : null;
        if (cursor && !anchor) return denied();
        const boundary = anchor ? Prisma.sql`WHERE ("lastActivityAt", "id") < (${anchor.lastActivityAt}, ${anchor.id})` : Prisma.empty;
        const rows = await tx.$queryRaw<Row[]>(Prisma.sql`WITH eligible AS (${eligible}) SELECT * FROM eligible ${boundary} ORDER BY "lastActivityAt" DESC, "id" DESC LIMIT 51`);
        const conversations = rows.slice(0, 50).map(row => ({ id: row.id, grantId: row.grantId, createdAt: row.createdAt, lastActivityAt: row.lastActivityAt,
            ...(row.protocol === 4 ? { protocol, machineId: row.machineId } : {}),
            turns: row.state === null ? [] : [{ state: historyState(row.state, row.deadline, row.leaseUntil, row.protocol === 4), createdAt: row.lastActivityAt }] }));
        return { conversations, nextCursor: rows.length > 50 ? conversations.at(-1)!.id : null };
    });
}

/** Retained owner reading uses immutable bindings and recipient envelopes, independent of execution authorization. */
export async function readOwnedServiceConversation(accountId: string, conversationId: string) {
    return inTx(async tx => {
        const row = await tx.aIServiceBinding.findUnique({ where: { id: conversationId }, include: { authorization: true } });
        if (!row) return null;
        const conversation = await tx.appChatConversation.findUnique({ where: { id: conversationId }, include: { grant: true } });
        const grant = row.authorization;
        const snapshot = ExecutionBindingSchema.safeParse(row.snapshot);
        const parsedScope = ServiceGrantScopeSchema.safeParse(grant?.scope);
        if (!conversation || !grant || !snapshot.success || !parsedScope.success || row.ownerId !== accountId || grant.ownerId !== accountId ||
            conversation.grant.accountId !== accountId || conversation.grant.protocol !== 4 || conversation.grantId !== grant.id ||
            row.appId !== delegatedApp.id || grant.appId !== row.appId || conversation.grant.appId !== row.appId || row.serviceId !== grant.serviceId ||
            snapshot.data.id !== row.id || snapshot.data.appId !== row.appId || snapshot.data.serviceId !== row.serviceId || snapshot.data.revision !== row.revision ||
            parsedScope.data.appId !== row.appId || parsedScope.data.serviceId !== row.serviceId) return denied();
        const binding = snapshot.data, scope = parsedScope.data;
        const envelopes = grant.machineEnvelopes;
        const machineEnvelope = envelopes && typeof envelopes === 'object' && !Array.isArray(envelopes) ? (envelopes as Prisma.JsonObject)[binding.machineId] : undefined;
        if (typeof machineEnvelope !== 'string' || !machineEnvelope) return denied();
        const rows = await tx.appChatTurn.findMany({ where: { conversationId, bindingId: row.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1,
            select: { id: true, requestId: true, input: true, output: true, sequence: true, state: true, createdAt: true, actual: true, deadline: true, leaseUntil: true } });
        const turns = rows.map(({ actual, deadline, leaseUntil, ...turn }) => {
            const parsed = TurnActualSchema.safeParse(actual);
            return { ...turn, state: historyState(turn.state, deadline, leaseUntil, true), ...(parsed.success ? { actual: parsed.data } : {}) };
        });
        return { protocol, app: { id: row.appId, origin: delegatedApp.origin }, conversationId, grantId: grant.id, ownerId: accountId,
            machineId: binding.machineId, scope, grantExpiresAt: grant.expiresAt?.toISOString() ?? null, machineEnvelope, binding,
            createdAt: conversation.createdAt, turns };
    });
}
