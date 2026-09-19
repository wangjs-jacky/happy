import { v4 as uuid } from 'uuid';
import { accountRuntimeCurrent } from '@/auth/accountRuntime';
import { resolveSessionState } from '@/utils/sessionUtils';
import { isSessionArchived } from '@/utils/sessionLifecycle';
import { createMessageStagingQueue } from './messageStagingQueue';
import { clearMessageStagingStorage, initializeMessageStagingPersistence, messageStagingPersistence } from './messageStagingQueuePersistence';
import { storage } from './storage';
import { sync } from './sync';
import { sessionAbort } from './ops';
import { resolveMessageModeMeta } from './messageMeta';
import type { AttachmentPreview } from './attachmentTypes';

export const messageStagingQueue = createMessageStagingQueue({
    ...messageStagingPersistence,
    session(id) {
        const state = storage.getState();
        const session = state.sessions[id];
        if (!session) return undefined;
        const resolved = resolveSessionState(session);
        return {
            connected: accountRuntimeCurrent() && !!sync.getCredentials()
                && !isSessionArchived(session) && state.socketStatus === 'connected' && resolved.isConnected,
            state: resolved.state,
            turnId: session.agentState?.turnStatus?.turnId,
            terminal: ['completed', 'cancelled', 'failed'].includes(session.agentState?.turnStatus?.status ?? ''),
        };
    },
    async send(message) {
        const credentials = sync.getCredentials();
        return sync.sendMessage(message.sessionId, message.text, {
            source: 'chat', attachments: message.attachments, modeMeta: message.modeMeta,
            isCurrent: () => accountRuntimeCurrent() && sync.getCredentials() === credentials,
        });
    },
    interrupt: sessionAbort,
});

let ready: Promise<void> | undefined;
export function initializeMessageStagingQueue() {
    ready ??= initializeMessageStagingPersistence().then(() => {
        messageStagingQueue.restore(messageStagingPersistence.load());
        messageStagingQueue.refresh();
    });
    return ready;
}

export async function clearMessageStagingQueue() {
    await initializeMessageStagingQueue();
    messageStagingQueue.clear();
    clearMessageStagingStorage();
}

export async function stageSessionMessage(sessionId: string, text: string, attachments?: AttachmentPreview[]) {
    const state = storage.getState();
    const session = state.sessions[sessionId];
    if (!session || !accountRuntimeCurrent()) throw new Error('Session unavailable');
    const modeMeta = resolveMessageModeMeta(session, state.settings);
    const selected = attachments?.map(a => ({ ...a }));
    await initializeMessageStagingQueue();
    if (!storage.getState().sessions[sessionId] || !accountRuntimeCurrent()) throw new Error('Session unavailable');
    messageStagingQueue.enqueue({
        id: uuid(), sessionId, text,
        attachments: selected,
        modeMeta,
    });
}
