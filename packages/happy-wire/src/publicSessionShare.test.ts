import { describe, expect, it } from 'vitest';
import { publicSessionSnapshotSchema } from './publicSessionShare';

const legacySnapshot = {
    version: 1 as const,
    title: 'Release review',
    sharedAt: 1_788_192_000_000,
    presentation: { groupToolCalls: true },
    messages: [{
        id: 'message-1',
        role: 'assistant' as const,
        createdAt: 1_788_192_000_000,
        blocks: [{ type: 'text' as const, markdown: 'Ready.' }],
    }],
};

describe('publicSessionSnapshotSchema', () => {
    it('keeps existing version-one snapshots valid without source metadata', () => {
        expect(publicSessionSnapshotSchema.parse(legacySnapshot).version).toBe(1);
    });

    it('accepts version-two appearance metadata with a registered theme pack', () => {
        const parsed = publicSessionSnapshotSchema.parse({
            ...legacySnapshot,
            version: 2,
            appearance: { themePack: 'sage' },
        });
        expect(parsed).toMatchObject({ appearance: { themePack: 'sage' } });
    });

    it('rejects an unregistered version-two appearance theme pack', () => {
        expect(() => publicSessionSnapshotSchema.parse({
            ...legacySnapshot,
            version: 2,
            appearance: { themePack: 'invented' },
        })).toThrow();
    });

    it.each(['paws', 'codex', 'claude-code'] as const)('accepts the display-safe %s provider label', (provider) => {
        expect(publicSessionSnapshotSchema.parse({
            ...legacySnapshot,
            source: { provider },
        }).source).toEqual({ provider });
    });

    it('rejects private provider identifiers in source metadata', () => {
        expect(() => publicSessionSnapshotSchema.parse({
            ...legacySnapshot,
            source: { provider: 'codex', sessionId: 'private-session-id' },
        })).toThrow();
    });
});
