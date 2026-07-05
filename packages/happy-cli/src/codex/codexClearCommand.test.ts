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
