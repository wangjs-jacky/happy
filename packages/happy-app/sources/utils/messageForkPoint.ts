import type { Message, UserTextMessage } from '@/sync/typesMessage';

export type MessageForkTarget = {
    messageId: string;
    messageText: string;
    rewindPointId: string | undefined;
};

/**
 * Messages are newest-first. Walking from oldest to newest keeps the latest
 * user prompt in hand, so each visible agent response can fork its full turn.
 */
export function getAgentMessageForkTargets(messages: Message[]): Map<string, MessageForkTarget> {
    const targets = new Map<string, MessageForkTarget>();
    let currentUserMessage: UserTextMessage | null = null;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.kind === 'user-text') {
            currentUserMessage = message;
            continue;
        }
        if (message.kind !== 'agent-text' || message.isThinking || !currentUserMessage) {
            continue;
        }

        targets.set(message.id, {
            messageId: message.id,
            messageText: currentUserMessage.text,
            rewindPointId: currentUserMessage.claudeUuid ?? currentUserMessage.codexItemId,
        });
    }

    return targets;
}
