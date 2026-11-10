import { z } from 'zod';
import { GoalProjectSchema, GoalBoardSnapshotSchema, GoalTaskSessionSchema, type GoalTask, type GoalBoardSnapshot } from '@slopus/happy-wire';
import { assertAccountRuntime, getRuntimeAccountSelection } from '@/auth/accountRuntime';
import { apiSocket } from './apiSocket';
import { machineStartGoalTask } from './ops';
import type { FileWorkspaceBinding } from '@/components/fileWorkspace/SessionFileWorkspaceProvider';
import { t } from '@/text';
// A conservative client latch only covers stale snapshots after an uncertain
// request. The authoritative once-only decision remains the daemon's journal.
const attempted = new Set<string>();
function attemptKey(machineId: string, task: GoalTask) { return JSON.stringify([owner(), machineId, task.indexPath]); }
export function projectTaskExecutionAttempted(machineId: string, task: GoalTask) { return attempted.has(attemptKey(machineId, task)); }
export function markProjectTaskExecutionAttempt(machineId: string, task: GoalTask) { attempted.add(attemptKey(machineId, task)); }
export function clearUndispatchedProjectTaskAttempt(machineId: string, task: GoalTask) { attempted.delete(attemptKey(machineId, task)); }
export class ProjectGoalLaunchError extends Error {
    constructor(message: string, readonly notDispatched: boolean) { super(message); }
}

function owner() {
    assertAccountRuntime();
    const account = getRuntimeAccountSelection();
    return JSON.stringify([account?.key, account?.generation, account?.serverUrl]);
}
export async function projectGoalRequest<T>(machineId: string, method: string, input: unknown): Promise<T> {
    const current = owner();
    let response: T;
    try { response = await apiSocket.machineRPC<T, unknown>(machineId, method, input); }
    catch (error) {
        if (/method.*not found|unknown.*method|not.*registered/i.test(error instanceof Error ? error.message : String(error))) throw new Error(t('projectGoals.unsupported'));
        throw error;
    }
    if (owner() !== current) throw new Error('Project request account changed');
    if (response && typeof response === 'object' && 'error' in response) {
        const message = String(response.error);
        throw new Error(/method.*not found|unknown.*method|not.*registered/i.test(message) ? t('projectGoals.unsupported') : message);
    }
    return response;
}
export async function loadGoalProjects(machineId: string) {
    return z.object({ success: z.literal(true), projects: z.array(GoalProjectSchema).max(1000) }).parse(await projectGoalRequest(machineId, 'goalProjects', {})).projects;
}
export async function loadProjectGoalBoard(machineId: string, featurePath: string) {
    const result = z.object({ success: z.literal(true), snapshot: GoalBoardSnapshotSchema, sessions: z.record(z.string(), z.array(GoalTaskSessionSchema).max(1000)) }).parse(await projectGoalRequest(machineId, 'goalProjectRead', { featurePath }));
    if (result.snapshot.featurePath !== featurePath) throw new Error('Project returned a different feature');
    return result;
}
export async function launchProjectGoalTask(machineId: string, featurePath: string, task: GoalTask, action: 'chat' | 'execute', requestId: string, agent: 'codex' | 'claude') {
    const current = owner();
    const result = await machineStartGoalTask(machineId, { featurePath, taskId: task.id, action, requestId, agent });
    if (owner() !== current) throw new Error('Project launch account changed');
    if (result.type !== 'success') throw new ProjectGoalLaunchError(result.type === 'error' ? result.errorMessage : 'Task directory is unavailable', result.type === 'error' && 'notDispatched' in result && result.notDispatched === true);
    return result.sessionId;
}
const fileResponse = z.object({ success: z.literal(true), content: z.string().max(90 * 1024), size: z.number().int().nonnegative().max(50 * 1024 * 1024), revision: z.string().max(200), offset: z.number().int().nonnegative() });
const historyCursor = z.object({ sessionId: z.string(), updatedAt: z.number() });
export type ProjectHistoryCursor = z.infer<typeof historyCursor>;
export async function loadProjectTaskHistory(machineId: string, featurePath: string, taskId: string, cursor?: ProjectHistoryCursor) {
    return z.object({ success: z.literal(true), sessions: z.array(GoalTaskSessionSchema).max(25), nextCursor: historyCursor.optional() }).parse(await projectGoalRequest(machineId, 'goalTaskHistory', { featurePath, taskId, cursor }));
}
const mediaMime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
export function projectTaskFiles(machineId: string, featurePath: string, task: GoalTask): FileWorkspaceBinding {
    const root = task.indexPath.replace(/[\\/][^\\/]+$/, '');
    const input = { featurePath, taskId: task.id };
    const readBytes = async (path: string, signal?: AbortSignal) => {
        let offset = 0, revision: string | undefined, bytes: Uint8Array | undefined, transferId: string | undefined;
        // This is a finite file transfer, driven by byte offsets, not a task/status polling loop.
        do {
            signal?.throwIfAborted();
            const result = fileResponse.extend({ transferId: z.string() }).parse(await projectGoalRequest(machineId, 'goalTaskReadFile', { ...input, path, offset, revision, transferId }));
            signal?.throwIfAborted();
            if (result.offset !== offset || (revision && result.revision !== revision)) throw new Error('File changed during transfer');
            if (!bytes) bytes = new Uint8Array(result.size);
            const chunk = Uint8Array.from(atob(result.content), char => char.charCodeAt(0));
            if (offset + chunk.length > bytes.length || (!chunk.length && offset < bytes.length)) throw new Error('Incomplete file transfer');
            bytes.set(chunk, offset); offset += chunk.length; revision = result.revision; transferId = result.transferId;
        } while (offset < bytes.length);
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map(byte => byte.toString(16).padStart(2, '0')).join('');
        return { bytes, hash, fileRevision: revision };
    };
    return {
        // The provider already includes account, machine and canonical root in
        // its tuple. Avoid nested JSON here: MMKV rejects escaped backslashes.
        root, machineId, scope: `goal-task:${task.id}`,
        readBytes: async (path, signal) => (await readBytes(path, signal)).bytes,
        readText: async (path, signal) => {
            const { bytes, hash, fileRevision } = await readBytes(path, signal);
            const mime = mediaMime[path.split('.').pop()?.toLowerCase() ?? ''];
            if (mime) return { content: '', hash, fileRevision, media: { bytes, mime } };
            if (bytes.length > 2 * 1024 * 1024) throw new Error('File is too large for the text editor');
            if (bytes.includes(0)) throw new Error('Binary file cannot be opened as text');
            return { content: new TextDecoder('utf-8', { fatal: true }).decode(bytes), hash, fileRevision };
        },
        writeText: async (path, content, expectedHash) => {
            let binary = ''; for (const byte of new TextEncoder().encode(content)) binary += String.fromCharCode(byte);
            const result = z.object({ success: z.literal(true), hash: z.string(), revision: z.string() }).parse(await projectGoalRequest(machineId, 'goalTaskWriteFile', { ...input, path, content: btoa(binary), expectedHash }));
            return { hash: result.hash, fileRevision: result.revision };
        },
    };
}
export function taskApproval(task: GoalTask): 'accepted' | 'changed' | 'unreviewed' | 'noCriteria' {
    const outputs = task.artifacts.filter(artifact => artifact.relation === 'output');
    if (outputs.length && outputs.every(artifact => artifact.available && artifact.approval?.status === 'accepted')) return 'accepted';
    if (outputs.some(artifact => artifact.approval?.status === 'changed')) return 'changed';
    return task.acceptanceCriteria?.length ? 'unreviewed' : 'noCriteria';
}
export function taskCanExecute(task: GoalTask) { return task.execution?.state === 'never'; }
export type ProjectBoardData = { snapshot: GoalBoardSnapshot; sessions: Record<string, z.infer<typeof GoalTaskSessionSchema>[]> };
