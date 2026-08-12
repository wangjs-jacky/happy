import { describe, expect, it, vi } from 'vitest';

import { directMessageFork } from './directMessageFork';

const codexSource = {
    kind: 'codex' as const,
    sessionId: 'session-source',
    machineId: 'machine-1',
    directory: '/tmp/project',
    codexThreadId: 'thread-source',
};

describe('directMessageFork', () => {
    it('forks a Codex response at its known item without loading the rewind-point picker data', async () => {
        const listCodexRewindPoints = vi.fn();
        const spawnFork = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-forked' });

        const result = await directMessageFork({
            source: codexSource,
            messageId: 'agent-message-2',
            rewindPointId: 'item-2',
            messageText: 'second prompt',
        }, { listCodexRewindPoints, spawnFork });

        expect(result).toEqual({ type: 'success', sessionId: 'session-forked' });
        expect(listCodexRewindPoints).not.toHaveBeenCalled();
        expect(spawnFork).toHaveBeenCalledWith(codexSource, {
            cutAfterItemId: 'item-2',
            forkedFromMessageId: 'agent-message-2',
            retainSelectedTurn: true,
        });
    });

    it('resolves a live Codex response by its matching prompt before forking', async () => {
        const listCodexRewindPoints = vi.fn().mockResolvedValue({
            type: 'success',
            points: [
                { itemId: 'item-old', text: 'first prompt', timestamp: 1 },
                { itemId: 'item-new', text: 'second prompt', timestamp: 2 },
            ],
        });
        const spawnFork = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-forked' });

        await directMessageFork({
            source: codexSource,
            messageId: 'agent-message-live',
            rewindPointId: undefined,
            messageText: ' second   prompt ',
        }, { listCodexRewindPoints, spawnFork });

        expect(spawnFork).toHaveBeenCalledWith(codexSource, {
            cutAfterItemId: 'item-new',
            forkedFromMessageId: 'agent-message-live',
            retainSelectedTurn: true,
        });
    });

    it('forks a Claude response directly from the known user-message UUID', async () => {
        const source = {
            kind: 'claude' as const,
            sessionId: 'session-source',
            machineId: 'machine-1',
            directory: '/tmp/project',
            claudeSessionId: 'claude-source',
        };
        const listCodexRewindPoints = vi.fn();
        const spawnFork = vi.fn().mockResolvedValue({ type: 'success', sessionId: 'session-forked' });

        await directMessageFork({
            source,
            messageId: 'agent-message-1',
            rewindPointId: 'user-message-uuid',
            messageText: 'first prompt',
        }, { listCodexRewindPoints, spawnFork });

        expect(listCodexRewindPoints).not.toHaveBeenCalled();
        expect(spawnFork).toHaveBeenCalledWith(source, {
            cutAfterUuid: 'user-message-uuid',
            forkedFromMessageId: 'agent-message-1',
        });
    });

    it('does not fork when a live Codex prompt cannot be resolved', async () => {
        const listCodexRewindPoints = vi.fn().mockResolvedValue({
            type: 'success',
            points: [{ itemId: 'item-1', text: 'another prompt', timestamp: 1 }],
        });
        const spawnFork = vi.fn();

        const result = await directMessageFork({
            source: codexSource,
            messageId: 'agent-message-live',
            rewindPointId: undefined,
            messageText: 'missing prompt',
        }, { listCodexRewindPoints, spawnFork });

        expect(result).toEqual({ type: 'missing-rewind-point' });
        expect(spawnFork).not.toHaveBeenCalled();
    });

    it('does not guess when a live Codex prompt appears in more than one turn', async () => {
        const listCodexRewindPoints = vi.fn().mockResolvedValue({
            type: 'success',
            points: [
                { itemId: 'item-old', text: 'continue', timestamp: 1 },
                { itemId: 'item-new', text: ' continue ', timestamp: 2 },
            ],
        });
        const spawnFork = vi.fn();

        const result = await directMessageFork({
            source: codexSource,
            messageId: 'agent-message-live',
            rewindPointId: undefined,
            messageText: 'continue',
        }, { listCodexRewindPoints, spawnFork });

        expect(result).toEqual({ type: 'ambiguous-rewind-point' });
        expect(spawnFork).not.toHaveBeenCalled();
    });
});
