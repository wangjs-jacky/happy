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
    getMetadata: () => {
        codexThreadId?: string;
        codexSyncCursor?: { threadId: string; turnId: string };
    } | null;
    updateMetadata: (handler: (currentMetadata: any) => any) => void;
    updateMetadataAndAwait: (handler: (currentMetadata: any) => any) => Promise<void>;
    flush: () => Promise<void>;
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
    historyMode?: 'full' | 'after-cursor';
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

        const historyMode = opts.historyMode ?? 'full';
        const syncCursor = opts.session.getMetadata()?.codexSyncCursor;
        if (historyMode === 'full' || syncCursor?.threadId === resumedThread.threadId) {
            const { thread } = await opts.client.readThread({
                threadId: resumedThread.threadId,
                includeTurns: true,
            });
            const turns = thread.turns ?? [];
            let turnsToReplay = turns;
            if (historyMode === 'after-cursor') {
                const cursorIndex = turns.findIndex((turn) => turn.id === syncCursor?.turnId);
                // Legacy sessions have no cursor, and a missing cursor cannot be
                // reconciled safely without duplicating already mirrored turns.
                turnsToReplay = cursorIndex >= 0 ? turns.slice(cursorIndex + 1) : [];
            }

            const historicalEnvelopes = mapCodexThreadToSessionEnvelopes({ turns: turnsToReplay });
            for (const envelope of historicalEnvelopes) {
                opts.session.sendSessionProtocolMessage(envelope);
            }

            const lastReplayedTurn = turnsToReplay.at(-1);
            if (lastReplayedTurn) {
                // Persist the cursor only after the server has acknowledged all
                // deterministic envelope IDs. A crash can then cause a safe,
                // idempotent replay, but never a silently skipped Turn.
                await opts.session.flush();
                await opts.session.updateMetadataAndAwait((currentMetadata) => ({
                    ...currentMetadata,
                    codexSyncCursor: {
                        threadId: resumedThread.threadId,
                        turnId: lastReplayedTurn.id,
                    },
                }));
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
