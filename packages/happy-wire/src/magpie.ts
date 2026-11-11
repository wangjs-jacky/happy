import { z } from 'zod';

const label = z.string().trim().min(1).max(80).refine(value => !value.startsWith('-') && !/[\x00-\x1f\x7f]/.test(value));
export const MagpieActionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('inspect') }).strict(),
    z.object({ action: z.literal('refresh'), accountId: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    z.object({ action: z.literal('rename'), accountId: z.string().regex(/^[a-f0-9]{64}$/), name: label }).strict(),
    z.object({ action: z.literal('switch'), accountId: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict(),
]);
export type MagpieAction = z.infer<typeof MagpieActionSchema>;

export const MagpieAccountSchema = z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/), agent: z.string().max(80), user: z.string().max(512),
    name: z.string().max(512), plan: z.string().max(120), active: z.boolean(), enabled: z.boolean(),
    needsLogin: z.boolean(), quotaError: z.boolean(), readAt: z.string().nullable(),
    windows: z.array(z.object({ name: z.string().max(120), remaining: z.number().min(0).max(100).nullable(), resetsAt: z.string().nullable() })).max(30),
    canSwitch: z.boolean(), canRename: z.boolean(),
});
export type MagpieAccount = z.infer<typeof MagpieAccountSchema>;
export const MagpieSnapshotSchema = z.object({
    status: z.enum(['ready', 'not-installed', 'error']), version: z.string().max(80).nullable(),
    accounts: z.array(MagpieAccountSchema).max(1000), observedAt: z.string(),
    error: z.enum(['unavailable', 'invalid-response', 'busy', 'account-missing', 'unsupported-action', 'operation-failed', 'verification-failed']).nullable(),
    // A failed read-back must never be presented as an unchanged or successful write.
    changed: z.boolean(),
});
export type MagpieSnapshot = z.infer<typeof MagpieSnapshotSchema>;
