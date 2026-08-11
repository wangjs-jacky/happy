import { describe, expect, it } from 'vitest';
import type { Message } from '@/sync/typesMessage';
import { getAgentMessageForkTargets } from './messageForkPoint';

describe('getAgentMessageForkTargets', () => {
    it('maps each visible agent response to the user prompt that owns its turn', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'agent-new',
                localId: null,
                createdAt: 6,
                text: 'New response',
            },
            {
                kind: 'tool-call',
                id: 'tool-new',
                localId: null,
                createdAt: 5,
                tool: {
                    name: 'Bash',
                    state: 'completed',
                    input: {},
                    createdAt: 5,
                    startedAt: 5,
                    completedAt: 5,
                    description: null,
                },
                children: [],
            },
            {
                kind: 'user-text',
                id: 'user-new',
                localId: null,
                createdAt: 4,
                text: 'New prompt',
                codexItemId: 'codex-user-new',
            },
            {
                kind: 'agent-text',
                id: 'agent-old',
                localId: null,
                createdAt: 3,
                text: 'Old response',
            },
            {
                kind: 'agent-text',
                id: 'thinking-old',
                localId: null,
                createdAt: 2,
                text: 'Hidden reasoning',
                isThinking: true,
            },
            {
                kind: 'user-text',
                id: 'user-old',
                localId: null,
                createdAt: 1,
                text: 'Old prompt',
                claudeUuid: 'claude-user-old',
            },
        ];

        const targets = getAgentMessageForkTargets(messages);

        expect(targets.get('agent-new')).toEqual({
            messageId: 'agent-new',
            messageText: 'New prompt',
            rewindPointId: 'codex-user-new',
        });
        expect(targets.get('agent-old')).toEqual({
            messageId: 'agent-old',
            messageText: 'Old prompt',
            rewindPointId: 'claude-user-old',
        });
        expect(targets.has('thinking-old')).toBe(false);
    });

    it('does not offer a fork target for agent text before the first user prompt', () => {
        const messages: Message[] = [{
            kind: 'agent-text',
            id: 'agent-only',
            localId: null,
            createdAt: 1,
            text: 'Startup message',
        }];

        expect(getAgentMessageForkTargets(messages).size).toBe(0);
    });
});
