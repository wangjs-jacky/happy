import { describe, expect, it, vi } from 'vitest';

import { completeCodexProcessorStartup } from './runCodex';

describe('Codex processor startup trace', () => {
    it('waits for thread availability before recording and emitting processor ready', async () => {
        const order: string[] = [];
        let releaseThread!: () => void;
        const threadAvailable = new Promise<void>((resolve) => { releaseThread = resolve; });
        const session = {
            processorReady: vi.fn(() => { order.push('ready-span'); return true; }),
            sendSessionEvent: vi.fn(() => { order.push('ready-event'); }),
        };

        const completion = completeCodexProcessorStartup(session as any, async () => {
            order.push('thread-starting');
            await threadAvailable;
            order.push('thread-ready');
        });
        await Promise.resolve();
        expect(order).toEqual(['thread-starting']);

        releaseThread();
        await completion;

        expect(order).toEqual(['thread-starting', 'thread-ready', 'ready-span', 'ready-event']);
        expect(session.sendSessionEvent).toHaveBeenCalledWith({ type: 'ready' });
    });
});
