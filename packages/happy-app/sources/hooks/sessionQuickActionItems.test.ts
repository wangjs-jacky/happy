import { describe, expect, it, vi } from 'vitest';
import { buildSessionQuickActionItems } from './sessionQuickActionItems';

const labels = {
    details: 'Details',
    resume: 'Resume',
    rename: 'Rename',
    regenerateTitle: 'Regenerate title',
    fork: 'Fork',
    duplicate: 'Duplicate',
    copyMetadata: 'Copy metadata',
    copyMetadataAndLogs: 'Copy metadata & logs',
    archive: 'Archive',
    delete: 'Delete',
    select: 'Select',
};

const callbacks = {
    openDetails: vi.fn(),
    resumeSession: vi.fn(),
    renameSession: vi.fn(),
    regenerateTitle: vi.fn(),
    forkSession: vi.fn(),
    openDuplicateSheet: vi.fn(),
    copySessionMetadata: vi.fn(),
    copySessionMetadataAndLogs: vi.fn(),
    archiveSession: vi.fn(),
    deleteSession: vi.fn(),
};

describe('buildSessionQuickActionItems', () => {
    it('offers rename, archive, and delete for active sessions', () => {
        const items = buildSessionQuickActionItems({
            labels,
            callbacks: {
                ...callbacks,
                selectSession: vi.fn(),
            },
            canShowResume: false,
            canRegenerateTitle: false,
            canFork: false,
            canCopySessionMetadata: false,
            sessionActive: true,
            canSelect: true,
        });

        expect(items.map(item => item.id)).toEqual([
            'select',
            'details',
            'rename',
            'archive',
            'delete',
        ]);
    });

    it('offers delete but not archive for inactive sessions', () => {
        const items = buildSessionQuickActionItems({
            labels,
            callbacks: {
                ...callbacks,
                selectSession: vi.fn(),
            },
            canShowResume: false,
            canRegenerateTitle: false,
            canFork: false,
            canCopySessionMetadata: false,
            sessionActive: false,
            canSelect: false,
        });

        expect(items.map(item => item.id)).toEqual([
            'details',
            'rename',
            'delete',
        ]);
    });

    it('offers title regeneration only when the session reports support', () => {
        const items = buildSessionQuickActionItems({
            labels,
            callbacks,
            canShowResume: false,
            canRegenerateTitle: true,
            canFork: false,
            canCopySessionMetadata: false,
            sessionActive: true,
        });

        expect(items.map(item => item.id)).toEqual([
            'details',
            'rename',
            'regenerate-title',
            'archive',
            'delete',
        ]);
    });
});
