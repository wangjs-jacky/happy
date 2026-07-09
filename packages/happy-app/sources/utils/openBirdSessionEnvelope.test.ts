import { describe, expect, it } from 'vitest';
import type { Session } from '@/sync/storageTypes';
import type { Message, ToolCall } from '@/sync/typesMessage';
import { buildOpenBirdTranscriptEnvelope, hasOpenBirdShareContent } from './openBirdSessionEnvelope';

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

describe('buildOpenBirdTranscriptEnvelope', () => {
    it('produces a contract-compliant generic transcript envelope with meta and messages', () => {
        const session = makeSession();
        const messages: Message[] = [
            userText('u1', 'Make me an overview', 1000),
            agentText('a1', 'Here is the overview.', 2000),
        ];

        const envelope = buildOpenBirdTranscriptEnvelope(session, messages, { sharedAt: Date.parse('2026-07-09T12:00:00Z') });

        expect(envelope.temp).toBe(true);
        expect(envelope.theme).toBe('document');
        expect(envelope.meta).toEqual({
            title: 'GPT Image 2 style overview',
            subtitle: 'claude-opus-4-8',
            source: 'Happy',
            date: '2026-07-09',
            count: 2,
        });
        // Envelope carries only generic {role, name, markdown} messages — no tools/options fields.
        expect(envelope.messages).toHaveLength(2);
        expect(envelope.messages[0]).toEqual({ role: 'user', name: null, markdown: 'Make me an overview' });
        expect(envelope.messages[1]).toEqual({ role: 'assistant', name: null, markdown: 'Here is the overview.' });
        expect(Object.keys(envelope)).toEqual(['temp', 'theme', 'meta', 'messages']);
        expect('tools' in envelope.messages[1]).toBe(false);
        expect('options' in envelope.messages[1]).toBe(false);
    });

    it('honors an explicit theme and falls back to path/title with null subtitle', () => {
        const session = makeSession({ summary: undefined, currentModelCode: undefined });
        const envelope = buildOpenBirdTranscriptEnvelope(session, [userText('u1', 'hi', 1)], { theme: 'chat' });
        expect(envelope.theme).toBe('chat');
        expect(envelope.meta.title).toBe('/repo');
        expect(envelope.meta.subtitle).toBeNull();
    });

    it('folds tool activity into a :::details block at the top of the assistant markdown', () => {
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

        const envelope = buildOpenBirdTranscriptEnvelope(session, messages);
        const assistant = envelope.messages.find(m => m.role === 'assistant')!;
        const md = assistant.markdown;

        // details block sits before the body, steps are inner list items.
        expect(md.startsWith(':::details ')).toBe(true);
        expect(md).toContain('Read · Read presets index');
        expect(md).toContain('- presets/index.ts');
        expect(md).toContain('- found 3 presets');
        // block is closed before the body text.
        const detailsClose = md.indexOf('\n:::');
        expect(detailsClose).toBeGreaterThan(-1);
        expect(md.indexOf('Done.')).toBeGreaterThan(detailsClose);
    });

    it('renders AskUserQuestion as a :::choices block at the tail with [x]/[ ] markers', () => {
        const session = makeSession();
        const messages: Message[] = [
            agentText('a1', 'Pick one:', 900),
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

        const envelope = buildOpenBirdTranscriptEnvelope(session, messages);
        const assistant = envelope.messages.find(m => m.role === 'assistant')!;
        const md = assistant.markdown;

        expect(md).toContain(':::choices');
        expect(md).toContain('- [x] Generate a comparison set');
        expect(md).toContain('- [ ] Export all presets');
        // choices sit at the tail, after the body.
        expect(md.indexOf('Pick one:')).toBeLessThan(md.indexOf(':::choices'));
        expect(md.trimEnd().endsWith(':::')).toBe(true);
        // no folded tool block for AskUserQuestion.
        expect(md).not.toContain(':::details');
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

        const envelope = buildOpenBirdTranscriptEnvelope(session, messages, {
            attachmentUrls: { 'blob://img1': 'https://cdn.example.com/render.png' },
        });
        const assistant = envelope.messages.find(m => m.role === 'assistant')!;
        expect(assistant.markdown).not.toContain(':::details');
        expect(assistant.markdown).toContain('Here is the render:');
        expect(assistant.markdown).toContain('![render.png](https://cdn.example.com/render.png)');
    });

    it('composes tool details + body + choices into a single assistant markdown in order', () => {
        const session = makeSession();
        const messages: Message[] = [
            toolCall('t1', 1000, {
                name: 'Read',
                input: { file_path: 'a.ts' },
            }),
            agentText('a1', 'Here are your options.', 1100),
            toolCall('t2', 1200, {
                name: 'AskUserQuestion',
                input: {
                    questions: [{
                        header: 'Pick',
                        options: [
                            { label: 'Yes' },
                            { label: 'No' },
                        ],
                    }],
                },
                result: { answer: 'Yes' },
            }),
        ];

        const envelope = buildOpenBirdTranscriptEnvelope(session, messages);
        const assistant = envelope.messages.find(m => m.role === 'assistant')!;
        const md = assistant.markdown;
        const detailsIdx = md.indexOf(':::details');
        const bodyIdx = md.indexOf('Here are your options.');
        const choicesIdx = md.indexOf(':::choices');
        expect(detailsIdx).toBeGreaterThan(-1);
        expect(detailsIdx).toBeLessThan(bodyIdx);
        expect(bodyIdx).toBeLessThan(choicesIdx);
        expect(md).toContain('- [x] Yes');
        expect(md).toContain('- [ ] No');
    });

    it('groups consecutive assistant messages into a single message and skips thinking', () => {
        const session = makeSession();
        const messages: Message[] = [
            userText('u1', 'go', 1000),
            agentText('think', 'internal reasoning', 1500, true),
            agentText('a1', 'Part one.', 2000),
            agentText('a2', 'Part two.', 2100),
        ];

        const envelope = buildOpenBirdTranscriptEnvelope(session, messages);
        const assistantMessages = envelope.messages.filter(m => m.role === 'assistant');
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0].markdown).toBe('Part one.\n\nPart two.');
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
