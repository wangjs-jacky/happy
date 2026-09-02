import { MMKV } from 'react-native-mmkv';
import { z } from 'zod';
import type { PublicSessionThemePack } from '@slopus/happy-wire';
import { THEME_PACK_IDS } from '@/themePacksData';
import type { PublicSessionShareJob, PublicSessionShareQueueStorage } from './publicSessionShareQueue';

const queueStorage = new MMKV({ id: 'public-session-share-queue' });
const STORAGE_KEY = 'jobs-v1';

const themePackSchema = z.custom<PublicSessionThemePack>((value) => (
    typeof value === 'string' && THEME_PACK_IDS.includes(value)
)).catch('caramel');

const coverSelectionSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('pexels'),
        photoId: z.number().int().positive(),
    }).strict(),
    z.object({
        kind: z.literal('upload'),
        attachmentId: z.string().uuid(),
        uri: z.string().regex(/^(?:file|content|ph|assets-library|blob):/i),
        name: z.string().min(1).max(500),
        mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
        size: z.number().int().positive().max(100 * 1024 * 1024),
        width: z.number().int().positive().max(100_000),
        height: z.number().int().positive().max(100_000),
        thumbhash: z.string().max(1_000).optional(),
    }).strict(),
]).optional().catch(undefined);

const jobSchema = z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    title: z.string(),
    requestedAt: z.number().finite(),
    cutoffSeq: z.number().int().nonnegative(),
    ownerId: z.string().min(1),
    serverUrl: z.string().url(),
    groupToolCalls: z.boolean(),
    themePack: themePackSchema,
    coverSelection: coverSelectionSchema,
    status: z.enum(['queued', 'running', 'ready', 'failed']),
    progress: z.object({
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
    }),
    updatedAt: z.number().finite(),
    publicId: z.string().min(1).optional(),
    publishedAt: z.number().finite().optional(),
    error: z.string().optional(),
    notificationPending: z.boolean(),
});

export function parsePublicSessionShareJobs(raw: string | null | undefined): PublicSessionShareJob[] {
    if (!raw) return [];
    try {
        const parsed = z.array(jobSchema).safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : [];
    } catch {
        return [];
    }
}

export const publicSessionShareQueueStorage: PublicSessionShareQueueStorage = {
    load: () => parsePublicSessionShareJobs(queueStorage.getString(STORAGE_KEY)),
    save: (jobs) => queueStorage.set(STORAGE_KEY, JSON.stringify(jobs)),
};

export function clearPublicSessionShareQueueStorage(): void {
    queueStorage.clearAll();
}
