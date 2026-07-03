import { describe, expect, it, vi } from 'vitest';

import { resumeExistingThread } from './resumeExistingThread';

describe('resumeExistingThread', () => {
    it('resumes the thread and updates session metadata', async () => {
        const client = {
            resumeThread: vi.fn().mockResolvedValue({
                threadId: '019ccca2-1a77-7481-9873-de72f3464372',
                model: 'gpt-5.4',
            }),
        };
        const metadataHandlers: Array<(metadata: any) => any> = [];
        const session = {
            updateMetadata: vi.fn((handler) => metadataHandlers.push(handler)),
            sendSessionEvent: vi.fn(),
        };
        const messageBuffer = {
            addMessage: vi.fn(),
        };

        const result = await resumeExistingThread({
            client,
            session,
            messageBuffer,
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            cwd: '/tmp/project',
            mcpServers: { happy: { command: 'happy-mcp' } },
        });

        expect(result).toEqual({
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            model: 'gpt-5.4',
        });
        expect(client.resumeThread).toHaveBeenCalledWith({
            threadId: '019ccca2-1a77-7481-9873-de72f3464372',
            cwd: '/tmp/project',
            mcpServers: { happy: { command: 'happy-mcp' } },
        });
        expect(metadataHandlers).toHaveLength(1);
        expect(metadataHandlers[0]({ existing: true })).toEqual({
            existing: true,
            codexThreadId: '019ccca2-1a77-7481-9873-de72f3464372',
        });
        expect(messageBuffer.addMessage).toHaveBeenCalledWith(expect.stringContaining('Resumed thread'), 'status');
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'Resumed Codex thread 019ccca2-1a77-7481-9873-de72f3464372',
        });
    });

    it('wraps backend resume errors with the thread ID', async () => {
        const client = {
            resumeThread: vi.fn().mockRejectedValue(new Error('thread not found')),
        };
        const session = {
            updateMetadata: vi.fn(),
            sendSessionEvent: vi.fn(),
        };
        const messageBuffer = {
            addMessage: vi.fn(),
        };

        await expect(
            resumeExistingThread({
                client,
                session,
                messageBuffer,
                threadId: 'thread-404',
                cwd: '/tmp/project',
                mcpServers: {},
            }),
        ).rejects.toThrow('Failed to resume Codex thread thread-404: thread not found');
        expect(messageBuffer.addMessage).toHaveBeenCalledWith(
            'Cannot resume Codex thread thread-404: thread not found',
            'status',
        );
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: 'Cannot resume Codex thread thread-404: thread not found',
        });
    });

    it('explains empty rollout files as unrecoverable local history', async () => {
        const client = {
            resumeThread: vi.fn().mockRejectedValue(
                new Error('thread/resume: rollout at /tmp/rollout.jsonl is empty (code=-32603)'),
            ),
        };
        const session = {
            updateMetadata: vi.fn(),
            sendSessionEvent: vi.fn(),
        };
        const messageBuffer = {
            addMessage: vi.fn(),
        };

        await expect(
            resumeExistingThread({
                client,
                session,
                messageBuffer,
                threadId: '019f239e-929d-7c30-9386-aa7e0db538c4',
                cwd: '/tmp/project',
                mcpServers: {},
            }),
        ).rejects.toThrow('Failed to resume Codex thread 019f239e-929d-7c30-9386-aa7e0db538c4');

        const expectedMessage = [
            'Cannot resume Codex thread 019f239e-929d-7c30-9386-aa7e0db538c4.',
            'The local Codex session history is missing or empty, so Happy can show the chat record but Codex cannot restore the execution context.',
            'Start a new session from this chat instead.',
        ].join(' ');
        expect(messageBuffer.addMessage).toHaveBeenCalledWith(expectedMessage, 'status');
        expect(session.sendSessionEvent).toHaveBeenCalledWith({
            type: 'message',
            message: expectedMessage,
        });
    });
});
