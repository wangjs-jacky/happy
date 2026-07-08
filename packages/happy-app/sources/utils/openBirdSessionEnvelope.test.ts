import { describe, expect, it } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import type { Message, ToolCall } from '@/sync/typesMessage';
import { buildOpenBirdSessionEnvelope, hasOpenBirdShareContent } from './openBirdSessionEnvelope';

function makeSession(overrides: Partial<Session['metadata']> = {}): Session {
    return {
        id: 'sess-1',
        seq: 0,
        createdAt: 0,
        updatedAt: 0,
        active: false,
        metadataVersion: 1,
        modelMode: null,
        metadata: {
            path: '/repo',
            host: 'mac',
            summary: { text: 'GPT Image 2 style overview', updatedAt: 0 },
            currentModelCode: 'claude-opus-4-8',
            ...overrides,
        },
    } as unknown as Session;
}

function userText(id: string, text: string, createdAt: number): Message {
    return { kind: 'user-text', id, localId: null, createdAt, text };
}

function agentText(id: string, text: string, createdAt: number, isThinking = false): Message {
    return { kind: 'agent-text', id, localId: null, createdAt, text, isThinking };
}

function toolCall(
    id: string,
    createdAt: number,
    tool: Partial<ToolCall> & { name: string },
    children: Message[] = [],
): Message {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        tool: {
            state: 'completed',
            input: undefined,
            createdAt,
            startedAt: createdAt,
            completedAt: createdAt + 1,
            description: null,
            ...tool,
        },
        children,
    };
}

describe('buildOpenBirdSessionEnvelope', () => {
    it('produces a contract-compliant envelope with meta and turns', () => {
        const session = makeSession();
        const messages: Message[] = [
            userText('u1', 'Make me an overview', 1000),
            agentText('a1', 'Here is the overview.', 2000),
        ];

        const envelope = buildOpenBirdSessionEnvelope(session, messages, { sharedAt: Date.parse('2026-07-09T12:00:00Z') });

        expect(envelope.temp).toBe(true);
        expect(envelope.theme).toBe('document');
        expect(envelope.meta).toEqual({
            title: 'GPT Image 2 style overview',
            model: 'claude-opus-4-8',
            source: 'Happy',
            date: '2026-07-09',
            turnCount: 2,
        });
        expect(envelope.turns).toHaveLength(2);
        expect(envelope.turns[0]).toMatchObject({ role: 'user', markdown: 'Make me an overview', tools: [], options: [] });
        expect(envelope.turns[1]).toMatchObject({ role: 'assistant', markdown: 'Here is the overview.' });
    });

    it('honors an explicit theme and falls back to path/title for meta', () => {
        const session = makeSession({ summary: undefined, currentModelCode: undefined });
        const envelope = buildOpenBirdSessionEnvelope(session, [userText('u1', 'hi', 1)], { theme: 'chat' });
        expect(envelope.theme).toBe('chat');
        expect(envelope.meta.title).toBe('/repo');
        expect(envelope.meta.model).toBeNull();
    });

    it('collapses tool activity into { title, steps[] } before the assistant body', () => {
        const session = makeSession();
        const messages: Message[] = [
            userText('u1', 'read the file', 1000),
            toolCall('t1', 1500, {
                name: 'Read',
                description: 'Read presets index',
                input: { file_path: 'presets/index.ts' },
            }, [agentText('c1', 'found 3 presets', 1600)]),
            agentText('a1', 'Done.', 2000),
        ];

        const envelope = buildOpenBirdSessionEnvelope(session, messages);
        const assistant = envelope.turns.find(t => t.role === 'assistant')!;
        expect(assistant.tools).toHaveLength(1);
        expect(assistant.tools[0].title).toContain('Read');
        expect(assistant.tools[0].title).toContain('Read presets index');
        expect(assistant.tools[0].steps).toContain('presets/index.ts');
        expect(assistant.tools[0].steps).toContain('found 3 presets');
        expect(assistant.markdown).toBe('Done.');
    });

    it('maps AskUserQuestion into options[] with the selected flag', () => {
        const session = makeSession();
        const messages: Message[] = [
            toolCall('t1', 1000, {
                name: 'AskUserQuestion',
                input: {
                    questions: [{
                        header: 'Next step',
                        options: [
                            { label: 'Generate a comparison set', description: '...' },
                            { label: 'Export all presets', description: '...' },
                        ],
                    }],
                },
                result: { answer: 'Generate a comparison set' },
            }),
        ];

        const envelope = buildOpenBirdSessionEnvelope(session, messages);
        const assistant = envelope.turns.find(t => t.role === 'assistant')!;
        expect(assistant.options).toEqual([
            { label: 'Generate a comparison set', selected: true },
            { label: 'Export all presets', selected: false },
        ]);
        // AskUserQuestion is mapped to options, not a folded tool block.
        expect(assistant.tools).toHaveLength(0);
    });

    it('inlines uploaded images as ![alt](url) instead of a tool block', () => {
        const session = makeSession();
        const messages: Message[] = [
            agentText('a1', 'Here is the render:', 1000),
            toolCall('t1', 1100, {
                name: 'file',
                input: { ref: 'blob://img1', name: 'render.png', image: { width: 800, height: 600 } },
            }),
        ];

        const envelope = buildOpenBirdSessionEnvelope(session, messages, {
            attachmentUrls: { 'blob://img1': 'https://cdn.example.com/render.png' },
        });
        const assistant = envelope.turns.find(t => t.role === 'assistant')!;
        expect(assistant.tools).toHaveLength(0);
        expect(assistant.markdown).toContain('Here is the render:');
        expect(assistant.markdown).toContain('![render.png](https://cdn.example.com/render.png)');
    });

    it('groups consecutive assistant messages into a single turn and skips thinking', () => {
        const session = makeSession();
        const messages: Message[] = [
            userText('u1', 'go', 1000),
            agentText('think', 'internal reasoning', 1500, true),
            agentText('a1', 'Part one.', 2000),
            agentText('a2', 'Part two.', 2100),
        ];

        const envelope = buildOpenBirdSessionEnvelope(session, messages);
        const assistantTurns = envelope.turns.filter(t => t.role === 'assistant');
        expect(assistantTurns).toHaveLength(1);
        expect(assistantTurns[0].markdown).toBe('Part one.\n\nPart two.');
    });
});

describe('hasOpenBirdShareContent', () => {
    it('returns false when there is nothing renderable', () => {
        expect(hasOpenBirdShareContent([])).toBe(false);
        expect(hasOpenBirdShareContent([agentText('a1', '   ', 1, false)])).toBe(false);
    });
    it('returns true when a real message exists', () => {
        expect(hasOpenBirdShareContent([userText('u1', 'hello', 1)])).toBe(true);
    });
});
