import type { Message, ToolCallMessage } from '@/sync/typesMessage';

export type PersonalTimelineRow =
    | { kind: 'message'; id: string; createdAt: number; message: Exclude<Message, { kind: 'agent-event' | 'tool-call' }> }
    | { kind: 'activity'; id: string; createdAt: number; messages: ToolCallMessage[] };

/** Input and output are newest first, matching the shared message store. */
export function personalTimeline(messages: readonly Message[]): PersonalTimelineRow[] {
    const rows: PersonalTimelineRow[] = [];
    for (const message of messages) {
        if (message.kind === 'agent-event') continue;
        if (message.kind !== 'tool-call') {
            rows.push({ kind: 'message', id: message.id, createdAt: message.createdAt, message });
            continue;
        }
        const previous = rows[rows.length - 1];
        if (previous?.kind === 'activity') {
            previous.messages.push(message);
            // Anchor to the oldest call so new live calls don't collapse an
            // activity group the user has already opened.
            previous.id = `activity-${message.id}`;
        } else {
            rows.push({ kind: 'activity', id: `activity-${message.id}`, createdAt: message.createdAt, messages: [message] });
        }
    }
    return rows;
}

export function personalActivityState(messages: readonly ToolCallMessage[]) {
    if (messages.some(message => message.tool.permission?.status === 'pending')) return 'pending';
    if (messages.some(message => message.tool.state === 'running')) return 'running';
    if (messages.some(message => message.tool.state === 'error')) return 'error';
    if (messages.some(message => message.tool.state === 'cancelled')) return 'cancelled';
    return 'completed';
}
