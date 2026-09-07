import { z } from 'zod';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { getHappyClientId } from './apiSocket';

export const sessionChangeSchema = z.object({
    sessionId: z.string(), revision: z.string().regex(/^\d+$/), deleted: z.boolean(),
    lastMessageSeq: z.number().int().nonnegative(), metadataVersion: z.number().int(), agentStateVersion: z.number().int(),
});
export type SessionChange = z.infer<typeof sessionChangeSchema>;
const pageSchema = z.object({ changes: z.array(sessionChangeSchema), nextCursor: z.string(), hasMore: z.boolean() });
export async function fetchSessionChanges(credentials: AuthCredentials, cursor?: string): Promise<
    ({ kind: 'page' } & z.infer<typeof pageSchema>) | { kind: 'reset' } | { kind: 'unsupported' }
> {
    const query = new URLSearchParams({ limit: '200' });
    if (cursor !== undefined) query.set('cursor', cursor);
    const response = await fetch(`${getServerUrl()}/v3/sessions/changes?${query}`, {
        headers: { Authorization: `Bearer ${credentials.token}`, 'X-Happy-Client': getHappyClientId() },
    });
    if ([404, 405, 501].includes(response.status)) return { kind: 'unsupported' };
    if (response.status === 409) return { kind: 'reset' };
    if (!response.ok) throw new Error(`Session changes failed: ${response.status}`);
    return { kind: 'page', ...pageSchema.parse(await response.json()) };
}
