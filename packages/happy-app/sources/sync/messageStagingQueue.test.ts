import { describe, expect, it, vi } from 'vitest';
import { createMessageStagingQueue, type StagingSession, type StagingSnapshot } from './messageStagingQueue';

function setup(initial?: StagingSnapshot) {
    let session: StagingSession = { connected: true, state: 'running', turnId: 'old' };
    const send = vi.fn(async (_message: unknown): Promise<void> => undefined);
    const interrupt = vi.fn(async (): Promise<void> => undefined);
    const save = vi.fn();
    const queue = createMessageStagingQueue({
        load: () => initial ?? { messages: [], barriers: {} }, save,
        session: () => session, send, interrupt,
    });
    return { queue, send, interrupt, save,
        update(next: Partial<StagingSession>) { session = { ...session, ...next }; queue.refresh(); },
        add(id: string) { queue.enqueue({ id, sessionId: 's', text: id, modeMeta: { model: 'chosen' } }); },
    };
}
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('message staging queue', () => {
    it('allows a new user submission to retry a failed turn', async () => {
        const t = setup();
        t.update({ state: 'failed' });
        t.add('retry');
        await tick();
        expect(t.send).toHaveBeenCalledTimes(1);
        t.add('next');
        await tick();
        expect(t.send).toHaveBeenCalledTimes(1);
    });

    it('releases the barrier after a cancelled turn missed while backgrounded', async () => {
        const t = setup();
        t.update({ state: 'idle' });
        t.add('a'); t.add('b');
        await tick();
        t.update({ state: 'idle', turnId: 'cancelled-new-turn', terminal: true });
        await tick();
        expect(t.send).toHaveBeenCalledTimes(2);
    });

    it('does not leave a phantom turn barrier when a failed submission is removed', async () => {
        const t = setup();
        t.send.mockRejectedValueOnce(new Error('upload failed'));
        t.add('a'); t.add('b');
        t.update({ state: 'completed' });
        await tick();
        t.queue.remove('a');
        await tick();
        expect(t.send).toHaveBeenCalledTimes(2);
    });
    it('holds messages while busy, deletes without sending, and sends one per completed turn', async () => {
        const t = setup();
        t.add('a'); t.add('b'); t.add('c');
        t.queue.remove('b');
        expect(t.send).not.toHaveBeenCalled();
        t.update({ state: 'completed' });
        await tick();
        expect(t.send.mock.calls.map(c => c[0])).toHaveLength(1);
        expect(t.queue.getSnapshot().messages.map(m => m.id)).toEqual(['c']);
        t.queue.refresh(); t.queue.refresh();
        await tick();
        expect(t.send).toHaveBeenCalledTimes(1);
        t.update({ state: 'running', turnId: 'a-turn' });
        t.update({ state: 'completed' });
        await tick();
        expect(t.send).toHaveBeenCalledTimes(2);
        expect(t.queue.getSnapshot().messages).toEqual([]);
    });

    it('does not let rapid consecutive sends overtake the pending first turn', async () => {
        const t = setup();
        t.update({ state: 'idle' });
        t.add('a'); t.add('b');
        await tick();
        expect(t.send).toHaveBeenCalledTimes(1);
        t.update({ state: 'completed', turnId: 'a-turn' });
        await tick();
        expect(t.send).toHaveBeenCalledTimes(2);
    });

    it('prioritizes the selected message after interruption, ignoring the old turn completion', async () => {
        const t = setup();
        let finishAbort!: () => void;
        t.interrupt.mockImplementationOnce(() => new Promise<void>(r => { finishAbort = r; }));
        t.add('a'); t.add('b');
        const steering = t.queue.steer('b');
        t.queue.remove('b');
        expect(t.queue.getSnapshot().messages).toHaveLength(2);
        t.update({ state: 'completed' });
        expect(t.send).not.toHaveBeenCalled();
        finishAbort(); await steering;
        expect(t.send).toHaveBeenCalledTimes(1);
        expect(t.send).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', modeMeta: { model: 'chosen' } }));
        t.update({ state: 'running' }); // late update for old interrupted ID
        t.update({ state: 'completed' });
        expect(t.send).toHaveBeenCalledTimes(1);
        t.update({ state: 'running', turnId: 'b-turn' });
        t.update({ state: 'completed' });
        await tick();
        expect(t.send).toHaveBeenCalledTimes(2);
    });

    it('retains failed messages and blocks later messages until manual action', async () => {
        const t = setup();
        t.send.mockRejectedValueOnce(new Error('upload failed'));
        t.add('a'); t.add('b');
        t.update({ state: 'completed' });
        await tick();
        expect(t.queue.getSnapshot().messages[0].status).toBe('failed');
        t.queue.refresh();
        expect(t.send).toHaveBeenCalledTimes(1);
        await t.queue.steer('a');
        expect(t.send).toHaveBeenCalledTimes(2);
    });

    it('waits through disconnection, permissions and failures', async () => {
        const t = setup();
        t.add('a');
        t.update({ connected: false, state: 'completed' });
        t.update({ connected: true, state: 'permission_required' });
        t.update({ state: 'failed' });
        expect(t.send).not.toHaveBeenCalled();
        t.update({ state: 'completed' });
        await tick();
        expect(t.send).toHaveBeenCalledTimes(1);
    });

    it('does not automatically retry an ambiguous sending record after reload', async () => {
        const t = setup({ messages: [{ id: 'a', sessionId: 's', text: 'a', modeMeta: {}, status: 'sending' }], barriers: {} });
        t.update({ state: 'completed' });
        await tick();
        expect(t.send).not.toHaveBeenCalled();
        expect(t.queue.getSnapshot().messages[0].status).toBe('failed');
    });

    it('does not send after clearing the account during interruption', async () => {
        const t = setup();
        let finishAbort!: () => void;
        t.interrupt.mockImplementationOnce(() => new Promise<void>(r => { finishAbort = r; }));
        t.add('a');
        const steering = t.queue.steer('a');
        t.queue.clear(); finishAbort(); await steering;
        expect(t.send).not.toHaveBeenCalled();
        expect(t.queue.getSnapshot().messages).toEqual([]);
    });

    it('handles an entire fast turn occurring before send resolves', async () => {
        const t = setup();
        let accepted!: () => void;
        t.send.mockImplementationOnce(() => new Promise<void>(r => { accepted = r; }));
        t.add('a'); t.add('b');
        t.update({ state: 'completed' });
        t.update({ state: 'running', turnId: 'a-turn' });
        t.update({ state: 'completed' });
        accepted(); await tick();
        expect(t.send).toHaveBeenCalledTimes(2);
    });
});
