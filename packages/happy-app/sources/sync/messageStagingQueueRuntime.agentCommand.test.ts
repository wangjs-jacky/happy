import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: {} as any, send: vi.fn(), steer: vi.fn(),
    credentials: {}, id: 0,
}));
vi.mock('uuid', () => ({ v4: () => `command-${++mocks.id}` }));
vi.mock('@/auth/accountRuntime', () => ({ accountRuntimeCurrent: () => true }));
vi.mock('@/utils/sessionUtils', () => ({ resolveSessionState: (session: any) => ({ state: session.state, isConnected: true }) }));
vi.mock('@/utils/sessionLifecycle', () => ({ isSessionArchived: () => false }));
vi.mock('@/text', () => ({ t: () => 'Update Paws CLI to use /agent in this session.' }));
vi.mock('./messageStagingQueuePersistence', () => ({
    clearMessageStagingStorage: vi.fn(), initializeMessageStagingPersistence: async () => {},
    messageStagingPersistence: { load: () => ({ messages: [], barriers: {} }), save: vi.fn() },
}));
vi.mock('./storage', () => ({ storage: { getState: () => mocks.state } }));
vi.mock('./sync', () => ({ sync: { getCredentials: () => mocks.credentials, sendMessage: mocks.send } }));
vi.mock('./ops', () => ({ sessionSteer: mocks.steer }));
vi.mock('./messageMeta', () => ({ resolveMessageModeMeta: () => ({ permissionMode: 'read-only', model: 'gpt-test' }) }));
import { initializeMessageStagingQueue, messageStagingQueue, stageSessionMessage } from './messageStagingQueueRuntime';

beforeEach(async () => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue({}); mocks.steer.mockResolvedValue({ accepted: true });
    mocks.state = { socketStatus: 'connected', settings: {}, sessions: { chat: {
        state: 'running', metadata: { capabilities: { myAgentCommand: true, codexSteer: true } },
        agentState: { turnStatus: { turnId: 'current', status: 'running' } },
    } } };
    await initializeMessageStagingQueue(); messageStagingQueue.clear();
});

it('queues /agent as the next turn with its attachments and controls, even for send-now delivery', async () => {
    const attachments = [{ id: 'image', uri: 'file:///ref.png' }] as any;
    await stageSessionMessage('chat', '/agent 创建军师', attachments, 'steer');
    expect(mocks.steer).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(messageStagingQueue.getSnapshot().messages).toHaveLength(1);
    mocks.state.sessions.chat.state = 'completed';
    mocks.state.sessions.chat.agentState.turnStatus.status = 'completed';
    messageStagingQueue.refresh();
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith('chat', '/agent 创建军师', expect.objectContaining({
        attachments, modeMeta: { permissionMode: 'read-only', model: 'gpt-test' },
    }));
});

it('rejects unsupported CLI before accepting the draft into the queue', async () => {
    mocks.state.sessions.chat.metadata.capabilities.myAgentCommand = false;
    await expect(stageSessionMessage('chat', '/agent 创建军师')).rejects.toThrow('Update Paws CLI');
    expect(messageStagingQueue.getSnapshot().messages).toHaveLength(0);
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.steer).not.toHaveBeenCalled();
});

it('keeps normal same-turn steering when /agent is only mentioned in prose', async () => {
    await stageSessionMessage('chat', 'Explain /agent later; continue this task', undefined, 'steer');
    expect(mocks.steer).toHaveBeenCalledWith('chat', expect.objectContaining({ text: 'Explain /agent later; continue this task', expectedTurnId: 'current' }));
});
