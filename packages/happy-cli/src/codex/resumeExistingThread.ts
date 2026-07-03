import { trimIdent } from '@/utils/trimIdent';

type ResumeThreadClient = {
    resumeThread: (opts: {
        threadId: string;
        cwd: string;
        mcpServers: Record<string, unknown>;
    }) => Promise<{ threadId: string; model: string }>;
};

type ResumeThreadSession = {
    updateMetadata: (handler: (currentMetadata: any) => any) => void;
    sendSessionEvent: (event: { type: 'message'; message: string }) => void;
};

type ResumeThreadMessageBuffer = {
    addMessage: (message: string, type: 'status') => void;
};

function explainResumeFailure(threadId: string, reason: string): string {
    const lowerReason = reason.toLowerCase();
    const hasMissingRollout = lowerReason.includes('missing rollout path')
        || lowerReason.includes('rollout path')
        || lowerReason.includes('rollout at');
    const hasEmptyRollout = lowerReason.includes(' is empty')
        || lowerReason.includes('empty rollout');

    if (hasMissingRollout || hasEmptyRollout) {
        return [
            `Cannot resume Codex thread ${threadId}.`,
            'The local Codex session history is missing or empty, so Happy can show the chat record but Codex cannot restore the execution context.',
            'Start a new session from this chat instead.',
        ].join(' ');
    }

    return `Cannot resume Codex thread ${threadId}: ${reason}`;
}

export async function resumeExistingThread(opts: {
    client: ResumeThreadClient;
    session: ResumeThreadSession;
    messageBuffer: ResumeThreadMessageBuffer;
    threadId: string;
    cwd: string;
    mcpServers: Record<string, unknown>;
}): Promise<{ threadId: string; model: string }> {
    try {
        const resumedThread = await opts.client.resumeThread({
            threadId: opts.threadId,
            cwd: opts.cwd,
            mcpServers: opts.mcpServers,
        });

        opts.session.updateMetadata((currentMetadata) => ({
            ...currentMetadata,
            codexThreadId: resumedThread.threadId,
        }));
        opts.messageBuffer.addMessage(`Resumed thread ${trimIdent(resumedThread.threadId)}`, 'status');
        opts.session.sendSessionEvent({
            type: 'message',
            message: `Resumed Codex thread ${resumedThread.threadId}`,
        });

        return resumedThread;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const message = explainResumeFailure(opts.threadId, reason);
        opts.messageBuffer.addMessage(message, 'status');
        opts.session.sendSessionEvent({
            type: 'message',
            message,
        });
        throw new Error(`Failed to resume Codex thread ${opts.threadId}: ${reason}`);
    }
}
