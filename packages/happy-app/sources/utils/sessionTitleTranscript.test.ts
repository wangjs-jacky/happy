import { describe, expect, it } from 'vitest';
import type { Message } from '@/sync/typesMessage';
import { buildSessionTitleTranscript } from './sessionTitleTranscript';

describe('buildSessionTitleTranscript', () => {
    it('builds a chronological transcript from user and assistant text', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'a2',
                localId: null,
                createdAt: 3,
                text: 'We can add a regenerate button.',
            },
            {
                kind: 'user-text',
                id: 'u1',
                localId: null,
                createdAt: 1,
                text: 'hello',
                displayText: 'Please inspect the title logic',
            },
            {
                kind: 'tool-call',
                id: 'tool',
                localId: null,
                createdAt: 2,
                tool: {
                    name: 'rg',
                    state: 'completed',
                    input: {},
                    createdAt: 2,
                    startedAt: 2,
                    completedAt: 2,
                    description: null,
                },
                children: [],
            },
        ];

        expect(buildSessionTitleTranscript(messages)).toBe([
            'User: Please inspect the title logic',
            'Assistant: We can add a regenerate button.',
        ].join('\n'));
    });

    it('skips thinking and empty messages', () => {
        const messages: Message[] = [
            {
                kind: 'agent-text',
                id: 'thinking',
                localId: null,
                createdAt: 1,
                text: 'internal reasoning',
                isThinking: true,
            },
            {
                kind: 'user-text',
                id: 'empty',
                localId: null,
                createdAt: 2,
                text: '   ',
            },
        ];

        expect(buildSessionTitleTranscript(messages)).toBe('');
    });

    it('keeps the latest messages within the configured budget', () => {
        const messages: Message[] = Array.from({ length: 5 }, (_, index) => ({
            kind: 'user-text',
            id: `u${index}`,
            localId: null,
            createdAt: index,
            text: `message ${index}`,
        }));

        expect(buildSessionTitleTranscript(messages, { maxMessages: 3 })).toBe([
            'User: message 2',
            'User: message 3',
            'User: message 4',
        ].join('\n'));
    });
});
