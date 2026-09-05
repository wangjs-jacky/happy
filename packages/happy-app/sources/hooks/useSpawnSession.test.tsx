import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Machine } from '@/sync/storageTypes';
import type { SpawnSessionResult } from '@/sync/ops';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { useSpawnSession, type SpawnSessionArgs } from './useSpawnSession';
import { AttachmentSendError } from '@/sync/messageSendError';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001'),
    traceStartup: vi.fn(),
    spawnResult: { type: 'success', sessionId: 'session-1' } as SpawnSessionResult,
    machineSpawnNewSession: vi.fn(),
    ensureSessionHydrated: vi.fn(),
    refreshSessions: vi.fn(),
    sendMessage: vi.fn(),
    navigateToSession: vi.fn(),
    updatePermission: vi.fn(),
    updateModel: vi.fn(),
    updateEffort: vi.fn(),
    applySettings: vi.fn(),
    alert: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('expo-crypto', () => ({
    randomUUID: mocks.randomUUID,
}));
vi.mock('@/sync/sessionStartupTrace', () => ({
    traceStartup: mocks.traceStartup,
}));

vi.mock('@/sync/ops', () => ({
    machineSpawnNewSession: mocks.machineSpawnNewSession,
}));
vi.mock('@/sync/sync', () => ({
    sync: {
        ensureSessionHydrated: mocks.ensureSessionHydrated,
        refreshSessions: mocks.refreshSessions,
        sendMessage: mocks.sendMessage,
        applySettings: mocks.applySettings,
    },
}));
vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => ({
            updateSessionPermissionMode: mocks.updatePermission,
            updateSessionModelMode: mocks.updateModel,
            updateSessionEffortLevel: mocks.updateEffort,
            settings: {
                sidebarOrganization: {
                    lists: [{ id: 'happy-list', name: 'Happy', kind: 'workspace', color: 'blue', machineId: 'machine-1', path: '~/work', defaultAgent: 'codex', createdAt: 1 }],
                    tags: [],
                    sessions: {},
                },
            },
        }),
    },
}));
vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => mocks.navigateToSession,
}));
vi.mock('@/modal', () => ({
    Modal: {
        alert: mocks.alert,
        confirm: mocks.confirm,
    },
}));
vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

const machine: Machine = {
    id: 'machine-1',
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    active: true,
    activeAt: 1,
    metadata: {
        host: 'mac',
        platform: 'darwin',
        happyCliVersion: '1.0.0',
        happyHomeDir: '/Users/jacky/.happy',
        homeDir: '/Users/jacky',
    },
    metadataVersion: 1,
    daemonState: null,
    daemonStateVersion: 1,
};

const image = { id: 'image-1', uri: 'file:///image.png' } as AttachmentPreview;
const args: SpawnSessionArgs = {
    machineId: machine.id,
    machine,
    path: '~/work',
    agent: 'codex',
    worktreeKey: null,
    permissionMode: 'yolo',
    modelMode: 'default',
    effortLevel: null,
    prompt: 'Build it',
    images: [image],
};

type HookResult = ReturnType<typeof useSpawnSession>;

function renderHook(): { current: () => HookResult; unmount: () => void } {
    let result: HookResult | undefined;

    function HookHarness() {
        result = useSpawnSession();
        return null;
    }

    let renderer: { unmount: () => void } | undefined;
    act(() => {
        renderer = TestRenderer.create(React.createElement(HookHarness));
    });
    return {
        current: () => {
            if (!result) throw new Error('Hook did not render');
            return result;
        },
        unmount: () => act(() => renderer?.unmount()),
    };
}

describe('useSpawnSession', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.traceStartup.mockReset();
        mocks.spawnResult = { type: 'success', sessionId: 'session-1' };
        mocks.machineSpawnNewSession.mockImplementation(async () => mocks.spawnResult);
        mocks.ensureSessionHydrated.mockResolvedValue(true);
        mocks.refreshSessions.mockResolvedValue(undefined);
        mocks.sendMessage.mockResolvedValue({ type: 'queued', sessionId: 'session-1', localIds: ['local-1'] });
        mocks.confirm.mockResolvedValue(false);
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('将首条消息失败与同步失败分开，并在原会话重试同一份附件', async () => {
        mocks.sendMessage.mockRejectedValueOnce(new AttachmentSendError('attachment-upload-failed', 1));
        const onQueued = vi.fn();
        const hook = renderHook();
        await act(async () => { expect(await hook.current().spawn(args, false, onQueued)).toBe(false); });
        expect(hook.current().recoveryError).toMatchObject({ sessionId: 'session-1', stage: 'send', message: 'imageUpload.uploadFailedMessage' });
        expect(mocks.alert).not.toHaveBeenCalled();
        expect(onQueued).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();

        await act(async () => { expect(await hook.current().retryPending()).toBe(true); });
        expect(hook.current().recoveryError).toBeNull();
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).toHaveBeenNthCalledWith(2, 'session-1', args.prompt, {
            source: 'new_session', attachments: args.images,
        });
        expect(onQueued).toHaveBeenCalledTimes(1);
        expect(mocks.navigateToSession).toHaveBeenCalledTimes(1);
        hook.unmount();
    });

    it('发送失败后允许明确提交修正后的草稿，复用原会话且不重发旧附件', async () => {
        mocks.sendMessage.mockRejectedValueOnce(new AttachmentSendError('attachment-upload-failed', 1));
        const originalQueued = vi.fn();
        const replacementQueued = vi.fn();
        const hook = renderHook();
        await act(async () => { await hook.current().spawn(args, false, originalQueued); });
        await act(async () => {
            expect(await hook.current().retryPending({ prompt: '修正后的文字', images: [], onQueued: replacementQueued })).toBe(true);
        });
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).toHaveBeenLastCalledWith('session-1', '修正后的文字', {
            source: 'new_session', attachments: undefined,
        });
        expect(originalQueued).not.toHaveBeenCalled();
        expect(replacementQueued).toHaveBeenCalledTimes(1);
        hook.unmount();
    });

    it('同步重试成功但发送失败时更新失败阶段，不泄露内部异常', async () => {
        vi.useFakeTimers();
        mocks.ensureSessionHydrated.mockResolvedValue(false);
        const hook = renderHook();
        try {
            await act(async () => {
                const operation = hook.current().spawn(args);
                await vi.runAllTimersAsync();
                await operation;
            });
            expect(hook.current().recoveryError?.stage).toBe('hydration');
            mocks.ensureSessionHydrated.mockResolvedValue(true);
            mocks.sendMessage.mockRejectedValueOnce(new Error('private-network-detail'));
            await act(async () => { expect(await hook.current().retryPending()).toBe(false); });
            expect(hook.current().recoveryError).toMatchObject({
                stage: 'send', message: 'newSession.firstMessageFailed',
            });
            expect(mocks.alert).not.toHaveBeenCalled();
        } finally {
            hook.unmount();
            vi.useRealTimers();
        }
    });

    it('retains the first created session after local queue failure and retries without respawning', async () => {
        mocks.sendMessage.mockRejectedValueOnce(new Error('synthetic-queue-failure'));
        const hook = renderHook();
        await act(async () => { expect(await hook.current().spawn(args)).toBe(false); });
        expect(hook.current().recoveryError).toMatchObject({ sessionId: 'session-1' });
        await act(async () => { expect(await hook.current().spawn(args)).toBe(false); });
        mocks.sendMessage.mockResolvedValue({ type: 'queued', sessionId: 'session-1', localIds: ['local-1'] });
        await act(async () => { expect(await hook.current().retryPending()).toBe(true); });
        expect(mocks.machineSpawnNewSession.mock.calls.length).toBe(1);
        expect(mocks.navigateToSession.mock.calls.length).toBe(1);
        hook.unmount();
    });

    it('coalesces repeated initial clicks while the first spawn RPC is pending', async () => {
        let release!: (value: unknown) => void;
        mocks.machineSpawnNewSession.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const hook = renderHook();
        let first!: Promise<boolean>;
        await act(async () => {
            first = hook.current().spawn(args);
            expect(await hook.current().spawn(args)).toBe(false);
        });
        await act(async () => { release({ type: 'success', sessionId: 'session-1' }); expect(await first).toBe(true); });
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        hook.unmount();
    });

    it('retries navigation without queuing an already accepted first message again', async () => {
        mocks.navigateToSession.mockImplementationOnce(() => { throw new Error('synthetic-navigation-failure'); });
        const hook = renderHook();
        await act(async () => { expect(await hook.current().spawn(args)).toBe(false); });
        expect(hook.current().recoveryError).toMatchObject({ sessionId: 'session-1' });
        await act(async () => { expect(await hook.current().retryPending()).toBe(true); });
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        expect(mocks.navigateToSession).toHaveBeenCalledTimes(2);
        hook.unmount();
    });

    it('does not navigate without an explicit successful local queue receipt', async () => {
        mocks.sendMessage.mockResolvedValue(undefined);
        const hook = renderHook();
        await act(async () => { expect(await hook.current().spawn(args)).toBe(false); });
        expect(mocks.navigateToSession.mock.calls.length).toBe(0);
        hook.unmount();
    });

    it('creates and configures a session without sending or navigating from the core', async () => {
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().spawnSession(args);
        });

        expect(result).toEqual({ type: 'success', sessionId: 'session-1' });
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith({
            machineId: 'machine-1',
            directory: '/Users/jacky/work',
            approvedNewDirectoryCreation: false,
            agent: 'codex',
            environmentVariables: undefined,
        });
        expect(mocks.ensureSessionHydrated).toHaveBeenCalledWith('session-1');
        expect(mocks.refreshSessions).not.toHaveBeenCalled();
        expect(mocks.updatePermission).toHaveBeenCalledWith('session-1', 'yolo');
        expect(mocks.updateModel).toHaveBeenCalledWith('session-1', 'default');
        expect(mocks.updateEffort).toHaveBeenCalledWith('session-1', null);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('keeps the existing wrapper contract and sends/navigates exactly once', async () => {
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().spawn(args);
        });

        expect(result).toBe(true);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).toHaveBeenCalledWith('session-1', 'Build it', {
            source: 'new_session',
            attachments: [image],
        });
        expect(mocks.navigateToSession).toHaveBeenCalledTimes(1);
        expect(mocks.navigateToSession).toHaveBeenCalledWith('session-1');
        hook.unmount();
    });

    it('assigns a spawned session to the List supplied by the new-session route', async () => {
        const hook = renderHook();

        await act(async () => {
            await hook.current().spawnSession({ ...args, sidebarListId: 'happy-list' });
        });

        const list = { id: 'happy-list', name: 'Happy', kind: 'workspace', color: 'blue', machineId: 'machine-1', path: '~/work', defaultAgent: 'codex', createdAt: 1 };
        expect(mocks.applySettings).toHaveBeenCalledWith({
            sidebarOrganization: {
                lists: [list],
                tags: [],
                sessions: { 'session-1': { listId: 'happy-list', tagIds: [] } },
            },
        });
        hook.unmount();
    });

    it('does not refresh the account when one spawned session stays temporarily absent', async () => {
        vi.useFakeTimers();
        mocks.ensureSessionHydrated.mockResolvedValue(false);
        const hook = renderHook();
        let result;

        try {
            await act(async () => {
                const spawnPromise = hook.current().spawnSession(args);
                await vi.advanceTimersByTimeAsync(0);
                expect(mocks.ensureSessionHydrated).toHaveBeenCalledTimes(1);
                await vi.advanceTimersByTimeAsync(99);
                expect(mocks.ensureSessionHydrated).toHaveBeenCalledTimes(1);
                await vi.advanceTimersByTimeAsync(1);
                expect(mocks.ensureSessionHydrated).toHaveBeenCalledTimes(2);
                await vi.advanceTimersByTimeAsync(249);
                expect(mocks.ensureSessionHydrated).toHaveBeenCalledTimes(2);
                await vi.advanceTimersByTimeAsync(1);
                expect(mocks.ensureSessionHydrated).toHaveBeenCalledTimes(3);
                await vi.advanceTimersByTimeAsync(499);
                expect(mocks.ensureSessionHydrated).toHaveBeenCalledTimes(3);
                await vi.advanceTimersByTimeAsync(1);
                result = await spawnPromise;
            });

            expect(result).toEqual({
                type: 'error',
                message: 'newSession.sessionHydrationFailed',
                sessionId: 'session-1',
            });
            expect(mocks.ensureSessionHydrated).toHaveBeenCalledTimes(4);
            expect(mocks.ensureSessionHydrated).toHaveBeenNthCalledWith(4, 'session-1');
            expect(mocks.refreshSessions).not.toHaveBeenCalled();
            expect(mocks.updatePermission).not.toHaveBeenCalled();
            expect(mocks.sendMessage).not.toHaveBeenCalled();
            expect(mocks.navigateToSession).not.toHaveBeenCalled();
        } finally {
            hook.unmount();
            vi.useRealTimers();
        }
    });

    it('creates one trace and keeps traced spawn, hydrate, configure, local queue, and navigation in order', async () => {
        const order: string[] = [];
        mocks.traceStartup.mockImplementation((event: { stage: string }) => {
            order.push(event.stage);
        });
        mocks.machineSpawnNewSession.mockImplementation(async () => {
            order.push('spawn');
            return { type: 'success', sessionId: 'session-1' };
        });
        mocks.ensureSessionHydrated.mockImplementation(async () => {
            order.push('hydrate');
            return true;
        });
        mocks.updatePermission.mockImplementation(() => order.push('configure'));
        mocks.sendMessage.mockImplementation(async () => {
            order.push('send');
            return { type: 'queued', sessionId: 'session-1', localIds: ['local-1'] };
        });
        mocks.navigateToSession.mockImplementation(() => order.push('navigate'));
        const hook = renderHook();

        await act(async () => {
            await hook.current().spawn(args);
        });

        expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledWith(expect.objectContaining({
            traceId: '00000000-0000-4000-8000-000000000001',
        }));
        expect(order).toEqual([
            'web.spawn.clicked',
            'spawn',
            'hydrate',
            'web.session.hydrated',
            'configure',
            'send',
            'web.first_message.queued',
            'navigate',
            'web.session.navigated',
        ]);
        expect(mocks.traceStartup.mock.calls.map(([event]) => event)).toEqual([
            expect.objectContaining({
                traceId: '00000000-0000-4000-8000-000000000001',
                stage: 'web.spawn.clicked',
                machineId: 'machine-1',
                outcome: 'success',
            }),
            expect.objectContaining({
                traceId: '00000000-0000-4000-8000-000000000001',
                stage: 'web.session.hydrated',
                sessionId: 'session-1',
                machineId: 'machine-1',
                outcome: 'success',
            }),
            expect.objectContaining({
                traceId: '00000000-0000-4000-8000-000000000001',
                stage: 'web.first_message.queued',
                sessionId: 'session-1',
                machineId: 'machine-1',
                outcome: 'success',
            }),
            expect.objectContaining({
                traceId: '00000000-0000-4000-8000-000000000001',
                stage: 'web.session.navigated',
                sessionId: 'session-1',
                machineId: 'machine-1',
                outcome: 'success',
            }),
        ]);
        hook.unmount();
    });

    it('continues the spawn flow when startup tracing throws', async () => {
        mocks.traceStartup.mockImplementation(() => {
            throw new Error('trace-logger-failed');
        });
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().spawn(args);
        });

        expect(result).toBe(true);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        expect(mocks.navigateToSession).toHaveBeenCalledWith('session-1');
        hook.unmount();
    });

    it('does not repeat hydration telemetry when message queue recovery is retried', async () => {
        vi.useFakeTimers();
        mocks.ensureSessionHydrated.mockResolvedValue(false);
        const hook = renderHook();

        try {
            await act(async () => {
                const spawnPromise = hook.current().spawn(args);
                await vi.runAllTimersAsync();
                await spawnPromise;
            });

            mocks.ensureSessionHydrated.mockResolvedValue(true);
            mocks.sendMessage.mockRejectedValueOnce(new Error('queue failed'));
            await act(async () => {
                expect(await hook.current().retryPending()).toBe(false);
            });

            mocks.sendMessage.mockResolvedValueOnce({ type: 'queued', sessionId: 'session-1', localIds: ['local-1'] });
            await act(async () => {
                expect(await hook.current().retryPending()).toBe(true);
            });

            const hydratedEvents = mocks.traceStartup.mock.calls
                .map(([event]) => event)
                .filter((event) => event.stage === 'web.session.hydrated');
            expect(hydratedEvents).toHaveLength(1);
            expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
            expect(mocks.navigateToSession).toHaveBeenCalledTimes(1);
        } finally {
            hook.unmount();
            vi.useRealTimers();
        }
    });

    it('retries hydration without respawning and completes configure/send/navigation once', async () => {
        vi.useFakeTimers();
        mocks.ensureSessionHydrated.mockResolvedValue(false);
        const hook = renderHook();

        try {
            let firstResult;
            await act(async () => {
                const spawnPromise = hook.current().spawn(args);
                await vi.runAllTimersAsync();
                firstResult = await spawnPromise;
            });

            expect(firstResult).toBe(false);
            expect(hook.current().recoveryError).toMatchObject({ sessionId: 'session-1' });
            expect(mocks.updatePermission).not.toHaveBeenCalled();
            expect(mocks.sendMessage).not.toHaveBeenCalled();
            expect(mocks.navigateToSession).not.toHaveBeenCalled();

            mocks.ensureSessionHydrated.mockResolvedValue(true);
            let retryResult;
            await act(async () => {
                retryResult = await hook.current().retryPending();
            });

            expect(retryResult).toBe(true);
            expect(hook.current().recoveryError).toBeNull();
            expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
            expect(mocks.updatePermission).toHaveBeenCalledTimes(1);
            expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
            expect(mocks.sendMessage).toHaveBeenCalledWith('session-1', 'Build it', {
                source: 'new_session',
                attachments: [image],
            });
            expect(mocks.navigateToSession).toHaveBeenCalledTimes(1);

            await act(async () => {
                await hook.current().retryPending();
            });
            expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
            expect(mocks.updatePermission).toHaveBeenCalledTimes(1);
            expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
            expect(mocks.navigateToSession).toHaveBeenCalledTimes(1);
        } finally {
            hook.unmount();
            vi.useRealTimers();
        }
    });

    it('coalesces concurrent recovery actions into one queued message and navigation', async () => {
        vi.useFakeTimers();
        mocks.ensureSessionHydrated.mockResolvedValue(false);
        const hook = renderHook();

        try {
            await act(async () => {
                const spawnPromise = hook.current().spawn(args);
                await vi.runAllTimersAsync();
                await spawnPromise;
            });

            let resolveHydration: ((hydrated: boolean) => void) | undefined;
            mocks.ensureSessionHydrated.mockImplementation(() => new Promise<boolean>((resolve) => {
                resolveHydration = resolve;
            }));
            let firstRetry!: Promise<boolean>;
            let secondResult;
            await act(async () => {
                firstRetry = hook.current().retryPending();
                await Promise.resolve();
                secondResult = await hook.current().retryPending();
            });

            expect(secondResult).toBe(false);
            await act(async () => {
                resolveHydration?.(true);
                await firstRetry;
            });

            expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
            expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
            expect(mocks.navigateToSession).toHaveBeenCalledTimes(1);
        } finally {
            hook.unmount();
            vi.useRealTimers();
        }
    });

    it('keeps sending true until the wrapper finishes its initial message', async () => {
        let resolveSend: (() => void) | undefined;
        let markSendStarted: (() => void) | undefined;
        const sendStarted = new Promise<void>((resolve) => {
            markSendStarted = resolve;
        });
        mocks.sendMessage.mockImplementation(() => {
            markSendStarted?.();
            return new Promise((resolve) => {
                resolveSend = () => resolve({ type: 'queued', sessionId: 'session-1', localIds: ['local-1'] });
            });
        });
        const hook = renderHook();
        let spawnPromise: Promise<boolean>;

        await act(async () => {
            spawnPromise = hook.current().spawn(args);
            await sendStarted;
        });

        expect(hook.current().sending).toBe(true);
        await act(async () => {
            resolveSend?.();
            await spawnPromise!;
        });
        expect(hook.current().sending).toBe(false);
        hook.unmount();
    });

    it('returns cancelled when directory creation is declined', async () => {
        mocks.spawnResult = { type: 'requestToApproveDirectoryCreation', directory: '/Users/jacky/new' };
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().spawnSession(args);
        });

        expect(result).toEqual({ type: 'cancelled' });
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(1);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        expect(mocks.alert).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('retries once with approval when directory creation is accepted', async () => {
        mocks.machineSpawnNewSession
            .mockResolvedValueOnce({ type: 'requestToApproveDirectoryCreation', directory: '/Users/jacky/new' })
            .mockResolvedValueOnce({ type: 'success', sessionId: 'session-approved' });
        mocks.confirm.mockResolvedValue(true);
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().spawnSession(args);
        });

        expect(result).toEqual({ type: 'success', sessionId: 'session-approved' });
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(2);
        expect(mocks.machineSpawnNewSession.mock.calls[0][0].approvedNewDirectoryCreation).toBe(false);
        expect(mocks.machineSpawnNewSession.mock.calls[1][0].approvedNewDirectoryCreation).toBe(true);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('reuses one wrapper trace when approved directory creation retries the spawn RPC', async () => {
        mocks.machineSpawnNewSession
            .mockResolvedValueOnce({ type: 'requestToApproveDirectoryCreation', directory: '/Users/jacky/new' })
            .mockResolvedValueOnce({ type: 'success', sessionId: 'session-approved' });
        mocks.confirm.mockResolvedValue(true);
        const hook = renderHook();

        await act(async () => {
            await hook.current().spawn({ ...args, prompt: '', images: undefined });
        });

        expect(mocks.randomUUID).toHaveBeenCalledTimes(1);
        expect(mocks.machineSpawnNewSession).toHaveBeenCalledTimes(2);
        expect(mocks.machineSpawnNewSession.mock.calls[0][0].traceId).toBe('00000000-0000-4000-8000-000000000001');
        expect(mocks.machineSpawnNewSession.mock.calls[1][0].traceId).toBe('00000000-0000-4000-8000-000000000001');
        hook.unmount();
    });

    it('returns and reports an RPC error once', async () => {
        mocks.spawnResult = { type: 'error', errorMessage: 'RPC unavailable' };
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().spawnSession(args);
        });

        expect(result).toEqual({ type: 'error', message: 'RPC unavailable' });
        expect(mocks.alert).toHaveBeenCalledTimes(1);
        expect(mocks.alert).toHaveBeenCalledWith('common.error', 'RPC unavailable');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        hook.unmount();
    });
});
