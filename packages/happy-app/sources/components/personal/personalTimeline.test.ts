import { describe, expect, it } from 'vitest';
import type { AgentTextMessage, ToolCallMessage, UserTextMessage } from '@/sync/typesMessage';
import { personalActivityState, personalTimeline } from './personalTimeline';

const tool = (id: string, createdAt: number, state: ToolCallMessage['tool']['state'] = 'completed'): ToolCallMessage => ({
    id, createdAt, kind: 'tool-call', localId: null, children: [],
    tool: { name: id, state, input: {}, createdAt, startedAt: createdAt, completedAt: state === 'completed' ? createdAt + 1 : null, description: id },
});
const answer: AgentTextMessage = { id: 'answer', createdAt: 40, kind: 'agent-text', localId: null, text: 'Done' };
const user: UserTextMessage = { id: 'user', createdAt: 10, kind: 'user-text', localId: null, text: 'Request' };

describe('Personal conversation activity projection', () => {
    it('preserves descending conversation order and groups only adjacent tools without mutating the source', () => {
        const latest = tool('latest', 30), first = tool('first', 20);
        const messages = Object.freeze([answer, latest, first, user]);
        const rows = personalTimeline(messages);
        expect(rows.map(row => row.kind)).toEqual(['message', 'activity', 'message']);
        expect(rows.map(row => row.id)).toEqual(['answer', 'activity-first', 'user']);
        expect(rows[1]).toMatchObject({ createdAt: 30, messages: [latest, first] });
        expect(messages).toEqual([answer, latest, first, user]);
        expect(personalTimeline([latest, answer, first])).toHaveLength(3);
    });

    it('anchors an open activity to its oldest call when a new live tool is prepended', () => {
        const oldest = tool('oldest', 20), second = tool('second', 30);
        const before = personalTimeline([second, oldest, user]);
        const after = personalTimeline([tool('new-live', 40, 'running'), second, oldest, user]);
        expect(before[0].id).toBe('activity-oldest');
        expect(after[0].id).toBe(before[0].id);
        expect(after[0].kind === 'activity' && after[0].messages.map(message => message.id)).toEqual(['new-live', 'second', 'oldest']);
    });

    it('preserves failure and cancellation information while pending and running actions take precedence', () => {
        const failed = tool('failed', 20, 'error'), cancelled = tool('cancelled', 21, 'cancelled');
        const running = tool('running', 22, 'running');
        const pending = { ...running, tool: { ...running.tool, permission: { id: 'permission', status: 'pending' as const } } };
        expect(personalActivityState([failed, cancelled])).toBe('error');
        expect(personalActivityState([cancelled])).toBe('cancelled');
        expect(personalActivityState([failed, running])).toBe('running');
        expect(personalActivityState([failed, running, pending])).toBe('pending');
        expect(personalActivityState([tool('ok', 30)])).toBe('completed');
    });
});
