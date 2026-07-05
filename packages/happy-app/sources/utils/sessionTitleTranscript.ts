import type { Message } from '@/sync/typesMessage';

const DEFAULT_MAX_MESSAGES = 50;
const DEFAULT_MAX_MESSAGE_CHARS = 2_000;
const DEFAULT_MAX_TRANSCRIPT_CHARS = 12_000;

export interface BuildSessionTitleTranscriptOptions {
    maxMessages?: number;
    maxMessageChars?: number;
    maxTranscriptChars?: number;
}

function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function messageText(message: Message): { role: 'User' | 'Assistant'; text: string } | null {
    if (message.kind === 'user-text') {
        return { role: 'User', text: message.displayText ?? message.text };
    }

    if (message.kind === 'agent-text' && !message.isThinking) {
        return { role: 'Assistant', text: message.text };
    }

    return null;
}

export function buildSessionTitleTranscript(
    messages: Message[],
    options: BuildSessionTitleTranscriptOptions = {},
): string {
    const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    const maxMessageChars = options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS;
    const maxTranscriptChars = options.maxTranscriptChars ?? DEFAULT_MAX_TRANSCRIPT_CHARS;

    const lines = [...messages]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(messageText)
        .filter((entry): entry is { role: 'User' | 'Assistant'; text: string } => Boolean(entry))
        .map(entry => ({
            role: entry.role,
            text: entry.text.replace(/\s+/g, ' ').trim(),
        }))
        .filter(entry => entry.text.length > 0)
        .slice(-maxMessages)
        .map(entry => `${entry.role}: ${truncateText(entry.text, maxMessageChars)}`);

    if (lines.length === 0) {
        return '';
    }

    const selected: string[] = [];
    let totalLength = 0;

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        const nextLength = totalLength + line.length + (selected.length > 0 ? 1 : 0);
        if (selected.length > 0 && nextLength > maxTranscriptChars) {
            break;
        }
        selected.unshift(line);
        totalLength = nextLength;
        if (totalLength >= maxTranscriptChars) {
            break;
        }
    }

    return selected.join('\n');
}
