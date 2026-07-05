import { parseSpecialCommand, type SpecialCommandType } from '@/parsers/specialCommands';
import type { PendingAttachment } from '@/utils/MessageQueue2';

type CodexUserTextQueue<T> = {
    push: (message: string, mode: T, attachments?: PendingAttachment[]) => void;
    pushIsolateAndClear: (message: string, mode: T, attachments?: PendingAttachment[]) => void;
};

export function isCodexClearText(text: string): boolean {
    return parseSpecialCommand(text).type === 'clear';
}

function getIsolatedCommand(text: string): SpecialCommandType | null {
    const type = parseSpecialCommand(text).type;
    return type;
}

export function enqueueCodexUserText<T>(opts: {
    text: string;
    mode: T;
    attachments?: PendingAttachment[];
    queue: CodexUserTextQueue<T>;
}): SpecialCommandType | 'queued' {
    const isolatedCommand = getIsolatedCommand(opts.text);
    if (isolatedCommand) {
        opts.queue.pushIsolateAndClear(opts.text, opts.mode, opts.attachments);
        return isolatedCommand;
    }

    opts.queue.push(opts.text, opts.mode, opts.attachments);
    return 'queued';
}
