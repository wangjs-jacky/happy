import { apiSocket } from './apiSocket';
import { sync } from './sync';
import { machineAttachCodexCandidate } from './ops';

export type CodexAttachCandidate = {
    threadId: string;
    title: string;
    directory: string;
    createdAt: number;
    updatedAt: number;
    /** Explicit Paws history audit, absent for unmapped Desktop/legacy threads. */
    sourceSessionId?: string;
};

export type MachineCodexAttachCandidate = CodexAttachCandidate & {
    machineId: string;
    machineName: string;
};

export { filterCodexAttachCandidates } from './filterCodexAttachCandidates';

export async function listCodexAttachCandidates(
    machineId: string,
    existingThreadIds: string[],
): Promise<CodexAttachCandidate[]> {
    const response = await apiSocket.machineRPC<{ candidates: CodexAttachCandidate[] }, { existingThreadIds: string[] }>(
        machineId,
        'codex-list-attach-candidates',
        { existingThreadIds },
    );
    return response.candidates;
}

export async function attachCodexCandidate(
    machineId: string,
    threadId: string,
    sourceSessionId?: string,
): Promise<{ type: 'success'; sessionId: string }> {
    const result = await machineAttachCodexCandidate({ machineId, threadId, sourceSessionId });
    if (result.type !== 'success') {
        throw new Error(result.type === 'error' ? result.errorMessage : 'Unable to attach this Codex session.');
    }
    await sync.refreshSessions();
    return result;
}

export async function dismissCodexCandidate(machineId: string, threadId: string): Promise<void> {
    await apiSocket.machineRPC<{ type: 'success' }, { threadId: string }>(
        machineId,
        'codex-dismiss-attach-candidate',
        { threadId },
    );
}
