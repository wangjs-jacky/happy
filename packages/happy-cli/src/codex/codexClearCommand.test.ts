import { describe, expect, it, vi } from 'vitest';

import { enqueueCodexUserText } from './codexClearCommand';

describe('enqueueCodexUserText', () => {
    it('queues /clear in isolation instead of batching it into a model prompt', () => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
        };

        const result = enqueueCodexUserText({
            text: '  /clear  ',
            mode,
            queue,
        });

        expect(result).toBe('clear');
        expect(queue.pushIsolateAndClear).toHaveBeenCalledWith('  /clear  ', mode, undefined);
        expect(queue.push).not.toHaveBeenCalled();
    });

    it('queues /skills in isolation instead of batching it into a model prompt', () => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
        };

        const result = enqueueCodexUserText({
            text: '/skills',
            mode,
            queue,
        });

        expect(result).toBe('skills');
        expect(queue.pushIsolateAndClear).toHaveBeenCalledWith('/skills', mode, undefined);
        expect(queue.push).not.toHaveBeenCalled();
    });

    it('queues /goal in isolation instead of batching it into a model prompt', () => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
        };

        const result = enqueueCodexUserText({
            text: '/goal Reduce p95 latency',
            mode,
            queue,
        });

        expect(result).toBe('goal');
        expect(queue.pushIsolateAndClear).toHaveBeenCalledWith('/goal Reduce p95 latency', mode, undefined);
        expect(queue.push).not.toHaveBeenCalled();
    });

    it.each([
        ['/compact', 'compact'],
        ['/mcp verbose', 'mcp'],
        ['/usage weekly', 'usage'],
        ['/status', 'status'],
        ['/diff', 'diff'],
        ['/new', 'new'],
        ['/fork', 'fork'],
        ['/review focus on regressions', 'review'],
        ['/plan propose a migration', 'plan'],
    ] as const)('queues %s in isolation', (text, expected) => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
        };

        const result = enqueueCodexUserText({
            text,
            mode,
            queue,
        });

        expect(result).toBe(expected);
        expect(queue.pushIsolateAndClear).toHaveBeenCalledWith(text, mode, undefined);
        expect(queue.push).not.toHaveBeenCalled();
    });

    it('forwards image attachments alongside ordinary text', () => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
        };
        const attachments = [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png', name: 'pic' }];

        const result = enqueueCodexUserText({
            text: 'look at this',
            mode,
            attachments,
            queue,
        });

        expect(result).toBe('queued');
        expect(queue.push).toHaveBeenCalledWith('look at this', mode, attachments);
        expect(queue.pushIsolateAndClear).not.toHaveBeenCalled();
    });
});
