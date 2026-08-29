import type { SessionEnvelope } from '@slopus/happy-wire';
import { trimIdent } from '@/utils/trimIdent';
import type { ReasoningEffort, Thread } from './codexAppServerTypes';
import { mapCodexThreadToSessionEnvelopes } from './utils/sessionProtocolMapper';

type ResumeThreadClient = {
    resumeThread: (opts: {
        threadId: string;
        cwd: string;
        mcpServers: Record<string, unknown>;
    }) => Promise<{ threadId: string; model: string; reasoningEffort: ReasoningEffort | null }>;
    readThread: (opts: {
        threadId: string;
        includeTurns: boolean;
    }) => Promise<{ thread: Pick<Thread, 'turns'> }>;
};

type ResumeThreadSession = {
    updateMetadata: (handler: (currentMetadata: any) => any) => void;
    sendSessionEvent: (event: { type: 'message'; message: string }) => void;
    sendSessionProtocolMessage: (envelope: SessionEnvelope) => void;
};

type ResumeThreadMessageBuffer = {
    addMessage: (message: string, type: 'status') => void;
};

export async function resumeExistingThread(opts: {
    client: ResumeThreadClient;
    session: ResumeThreadSession;
    messageBuffer: ResumeThreadMessageBuffer;
    threadId: string;
    cwd: string;
    mcpServers: Record<string, unknown>;
    replayHistory?: boolean;
}): Promise<{ threadId: string; model: string; reasoningEffort: ReasoningEffort | null }> {
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

        if (opts.replayHistory !== false) {
            const { thread } = await opts.client.readThread({
                threadId: resumedThread.threadId,
                includeTurns: true,
            });
            const historicalEnvelopes = mapCodexThreadToSessionEnvelopes(thread);
            for (const envelope of historicalEnvelopes) {
                opts.session.sendSessionProtocolMessage(envelope);
            }
        }

        opts.messageBuffer.addMessage(`Resumed thread ${trimIdent(resumedThread.threadId)}`, 'status');
        opts.session.sendSessionEvent({
            type: 'message',
            message: `Resumed Codex thread ${resumedThread.threadId}`,
        });

        return resumedThread;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to resume Codex thread ${opts.threadId}: ${reason}`);
    }
}
