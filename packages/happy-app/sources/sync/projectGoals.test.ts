import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalTask } from '@slopus/happy-wire';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), launch: vi.fn(), account: { key: 'test', generation: 0, serverUrl: 'http://fixture' } }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC: mocks.rpc } }));
vi.mock('./ops', () => ({ machineStartGoalTask: mocks.launch }));
vi.mock('@/auth/accountRuntime', () => ({ assertAccountRuntime: () => {}, getRuntimeAccountSelection: () => mocks.account }));
vi.mock('@/text', () => ({ t: (value: string) => value }));
import { projectTaskFiles, projectTaskExecutionAttempted, markProjectTaskExecutionAttempt, clearUndispatchedProjectTaskAttempt, launchProjectGoalTask, ProjectGoalLaunchError, openProjectGoalConversation, loadGoalProjects, getProjectPreviewMachineId } from './projectGoals';
const task: GoalTask = { id: 'task', title: 'Task', indexPath: '/archive/task/index.md', status: 'pending', goal: 'Goal', expectedDeliverables: [], artifacts: [], dependencies: [], execution: { state: 'never' } };
beforeEach(() => { mocks.rpc.mockReset(); mocks.launch.mockReset(); mocks.account.generation++; });
afterEach(() => { delete (globalThis as any).__HAPPY_CONFIG__; });
describe('actual archive preview transport', () => {
    it('uses the configured archive owner only in the read-only preview', () => {
        (globalThis as any).__HAPPY_CONFIG__ = { goalProjectReadOnly: true, goalProjectMachineId: 'actual-machine' };
        expect(getProjectPreviewMachineId()).toBe('actual-machine');
        (globalThis as any).__HAPPY_CONFIG__.goalProjectReadOnly = false;
        expect(getProjectPreviewMachineId()).toBeUndefined();
    });
    it('reads the real machine through a separate read-only RPC namespace', async () => {
        (globalThis as any).__HAPPY_CONFIG__ = { goalProjectReadOnly: true };
        mocks.rpc.mockResolvedValue({ success: true, projects: [] });
        await loadGoalProjects('actual-machine');
        expect(mocks.rpc).toHaveBeenCalledWith('actual-machine', 'previewGoalProjects', {});
    });
    it('cannot launch a session or task through the read-only preview', async () => {
        (globalThis as any).__HAPPY_CONFIG__ = { goalProjectReadOnly: true };
        mocks.launch.mockResolvedValue({ type: 'success', sessionId: 'must-not-create' });
        await expect(launchProjectGoalTask('actual-machine', '/archive', task, 'chat', 'request', 'codex')).rejects.toThrow();
        expect(mocks.launch).not.toHaveBeenCalled();
    });
});
describe('project Task transport and conservative attempt state', () => {
    it('produces a Task workspace identity that can be persisted by MMKV', () => {
        const binding = projectTaskFiles('machine', '/archive', task);
        expect(JSON.stringify(['account', binding.machineId, binding.root, binding.scope])).not.toContain('\\');
    });
    it('keeps an uncertain execution locked across Task remounts and isolates accounts', async () => {
        markProjectTaskExecutionAttempt('machine', task);
        mocks.launch.mockResolvedValue({ type: 'error', errorMessage: 'Connection lost', outcomeUnknown: true });
        await expect(launchProjectGoalTask('machine', '/archive', task, 'execute', 'request', 'codex')).rejects.toMatchObject({ notDispatched: false });
        expect(projectTaskExecutionAttempted('machine', { ...task })).toBe(true);
        expect(projectTaskExecutionAttempted('other-machine', task)).toBe(false);
        mocks.account.generation++;
        expect(projectTaskExecutionAttempted('machine', task)).toBe(false);
    });
    it('preserves the proof that an authentication failure never dispatched a Task request', async () => {
        markProjectTaskExecutionAttempt('machine', task);
        mocks.launch.mockResolvedValue({ type: 'error', errorMessage: 'Authentication failed', notDispatched: true });
        try { await launchProjectGoalTask('machine', '/archive', task, 'execute', 'request', 'codex'); throw new Error('Expected failure'); }
        catch (error) { expect(error).toBeInstanceOf(ProjectGoalLaunchError); if (error instanceof ProjectGoalLaunchError && error.notDispatched) clearUndispatchedProjectTaskAttempt('machine', task); }
        expect(projectTaskExecutionAttempted('machine', task)).toBe(false);
    });
    it('stops the remaining archive chunks when the file owner is closed', async () => {
        const abort = new AbortController();
        mocks.rpc.mockImplementation(async () => { abort.abort(); return { success: true, content: Buffer.alloc(65536, 'a').toString('base64'), size: 1024 * 1024, revision: 'r', offset: 0, transferId: 'transfer' }; });
        await expect(projectTaskFiles('machine', '/archive', task).readText('/archive/task/large.txt', abort.signal)).rejects.toThrow();
        expect(mocks.rpc).toHaveBeenCalledTimes(1);
    });
});

describe('opening a Task conversation', () => {
    const session = (sessionId: string, updatedAt: number, directory = '/archive/task') => ({ sessionId, updatedAt, directory, title: sessionId, executed: false });
    it('resumes the newest conversation in this Task without creating or sending anything', async () => {
        mocks.rpc.mockResolvedValue({ success: true, sessions: [session('older', 10), session('unrelated', 50, '/archive/other'), session('newest', 20)] });
        const result = await openProjectGoalConversation('machine', '/archive', task, 'request', 'codex');
        expect(result).toMatchObject({ created: false, session: { sessionId: 'newest' } });
        expect(mocks.launch).not.toHaveBeenCalled();
    });
    it('creates an empty chat only once and resumes it on the next open', async () => {
        mocks.rpc.mockResolvedValueOnce({ success: true, sessions: [] }).mockResolvedValueOnce({ success: true, sessions: [session('created', 20)] });
        mocks.launch.mockResolvedValue({ type: 'success', sessionId: 'created' });
        expect((await openProjectGoalConversation('machine', '/archive', task, 'first', 'codex')).created).toBe(true);
        expect((await openProjectGoalConversation('machine', '/archive', task, 'second', 'codex')).created).toBe(false);
        expect(mocks.launch).toHaveBeenCalledExactlyOnceWith('machine', expect.objectContaining({ action: 'chat', taskId: task.id }));
    });
    it('does not turn a failed history read into a new duplicate chat', async () => {
        mocks.rpc.mockRejectedValue(new Error('History unavailable'));
        await expect(openProjectGoalConversation('machine', '/archive', task, 'request', 'codex')).rejects.toThrow('History unavailable');
        expect(mocks.launch).not.toHaveBeenCalled();
    });
    it('allows an explicit new conversation without replacing existing history', async () => {
        mocks.launch.mockResolvedValue({ type: 'success', sessionId: 'explicit-new' });
        const result = await openProjectGoalConversation('machine', '/archive', task, 'request', 'codex', [session('existing', 20)], true);
        expect(result).toMatchObject({ created: true, session: { sessionId: 'explicit-new' } });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });
    it('abandons opening when the account changes during the history read', async () => {
        mocks.rpc.mockImplementation(async () => { mocks.account.generation++; return { success: true, sessions: [] }; });
        await expect(openProjectGoalConversation('machine', '/archive', task, 'request', 'codex')).rejects.toThrow('account changed');
        expect(mocks.launch).not.toHaveBeenCalled();
    });
});
