import { describe, expect, it } from 'vitest';
import type { Message } from '@/sync/typesMessage';
import { collectGeneratedImagesFromMessages } from './generatedImagesModel';

function createFileMessage(id: string, input: Record<string, unknown>): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: id === 'newer' ? 2000 : 1000,
        tool: {
            name: 'file',
            state: 'completed',
            input,
            createdAt: 1000,
            startedAt: 1000,
            completedAt: 1001,
            description: null,
        },
        children: [],
    };
}

describe('collectGeneratedImagesFromMessages', () => {
    it('includes generated image file events with prompt metadata', () => {
        const entries = collectGeneratedImagesFromMessages('session-1', 'Sketch Session', [
            createFileMessage('newer', {
                ref: 'blob://generated',
                name: 'generated.png',
                source: 'generated',
                prompt: 'draw a mountain',
                batchId: 'batch-1',
                localPath: '/Users/jacky/.happy/generated-images/2026-07-07/batch-1/outputs/generated.png',
                image: { width: 1200, height: 900, thumbhash: 'abc' },
            }),
        ]);

        expect(entries).toEqual([expect.objectContaining({
            id: 'session-1:newer',
            sessionTitle: 'Sketch Session',
            ref: 'blob://generated',
            prompt: 'draw a mountain',
            batchId: 'batch-1',
            localPath: '/Users/jacky/.happy/generated-images/2026-07-07/batch-1/outputs/generated.png',
            width: 1200,
            height: 900,
            thumbhash: 'abc',
        })]);
    });

    it('keeps legacy send_image file events that predate source metadata', () => {
        const entries = collectGeneratedImagesFromMessages('session-1', 'Legacy Session', [
            createFileMessage('older', {
                ref: 'blob://legacy',
                name: 'legacy.png',
                image: { width: 800, height: 600 },
            }),
            createFileMessage('not-image', {
                ref: 'blob://document',
                name: 'notes.txt',
            }),
        ]);

        expect(entries).toEqual([expect.objectContaining({
            id: 'session-1:older',
            ref: 'blob://legacy',
            name: 'legacy.png',
            width: 800,
            height: 600,
        })]);
        expect(entries[0]?.prompt).toBeUndefined();
    });
});
