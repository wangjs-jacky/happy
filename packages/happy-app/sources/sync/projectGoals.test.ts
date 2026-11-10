import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GoalTask } from '@slopus/happy-wire';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), launch: vi.fn(), account: { key: 'test', generation: 0, serverUrl: 'http://fixture' } }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC: mocks.rpc } }));
vi.mock('./ops', () => ({ machineStartGoalTask: mocks.launch }));
vi.mock('@/auth/accountRuntime', () => ({ assertAccountRuntime: () => {}, getRuntimeAccountSelection: () => mocks.account }));
vi.mock('@/text', () => ({ t: (value: string) => value }));
import { projectTaskFiles, projectTaskExecutionAttempted, markProjectTaskExecutionAttempt, clearUndispatchedProjectTaskAttempt, launchProjectGoalTask, ProjectGoalLaunchError } from './projectGoals';
const task: GoalTask = { id: 'task', title: 'Task', indexPath: '/archive/task/index.md', status: 'pending', goal: 'Goal', expectedDeliverables: [], artifacts: [], dependencies: [], execution: { state: 'never' } };
beforeEach(() => { mocks.rpc.mockReset(); mocks.launch.mockReset(); mocks.account.generation++; });
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
