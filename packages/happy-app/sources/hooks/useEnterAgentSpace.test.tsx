import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLauncher } from '@/components/agents/launchAgent';
import type { Machine } from '@/sync/storageTypes';
import { useEnterAgentSpace } from './useEnterAgentSpace';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    machines: [] as Machine[],
    agentSpaceId: 'previous-space' as string | null,
    spawnSession: vi.fn(),
    navigateToSession: vi.fn(),
    setAgentSpaceId: vi.fn(),
    updateSessionDraft: vi.fn(),
    alert: vi.fn(),
    events: [] as string[],
}));

vi.mock('@/hooks/useSpawnSession', () => ({
    useSpawnSession: () => ({ spawnSession: mocks.spawnSession, sending: false, spawn: vi.fn() }),
}));
vi.mock('@/hooks/useNavigateToSession', () => ({
    useNavigateToSession: () => mocks.navigateToSession,
}));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mocks.machines,
    useLocalSettingMutable: () => [mocks.agentSpaceId, mocks.setAgentSpaceId],
    useSetting: () => ({
        codex: { permissionMode: 'read-only', modelMode: 'default-codex', effortLevel: 'medium' },
    }),
    storage: {
        getState: () => ({ updateSessionDraft: mocks.updateSessionDraft }),
    },
}));
vi.mock('@/hooks/useNewSessionDraft', () => ({
    useNewSessionDraft: () => ({
        agentType: 'opencode',
        permissionMode: 'default',
        modelMode: 'draft-model',
        effortLevel: 'high',
    }),
}));
vi.mock('@/modal', () => ({
    Modal: { alert: mocks.alert },
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

const agent: AgentLauncher = {
    id: 'agent-1',
    name: 'Agent',
    glyph: 'A',
    color: '#5e5791',
    machineId: machine.id,
    path: '~/work',
    kind: 'standard',
    spaceType: 'default',
    imageStyleIds: [],
    imageVariantsPerStyle: 1,
    presets: [],
};

type HookResult = ReturnType<typeof useEnterAgentSpace>;

function renderHook(): { current: () => HookResult; unmount: () => void } {
    let result: HookResult | undefined;

    function HookHarness() {
        result = useEnterAgentSpace();
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

describe('useEnterAgentSpace', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.events = [];
        mocks.machines = [machine];
        mocks.agentSpaceId = 'previous-space';
        mocks.spawnSession.mockImplementation(async () => {
            mocks.events.push('spawn');
            return { type: 'success', sessionId: 'session-1' };
        });
        mocks.updateSessionDraft.mockImplementation(() => mocks.events.push('draft'));
        mocks.setAgentSpaceId.mockImplementation((id: string | null) => mocks.events.push(`space:${id}`));
        mocks.navigateToSession.mockImplementation(() => mocks.events.push('navigate'));
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('spawns a blank Agent-bound session, enters its space, then navigates', async () => {
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().enter(agent);
        });

        expect(result).toEqual({ type: 'success', sessionId: 'session-1' });
        expect(mocks.spawnSession).toHaveBeenCalledWith({
            machineId: machine.id,
            machine,
            path: '~/work',
            agent: 'opencode',
            worktreeKey: null,
            permissionMode: 'default',
            modelMode: 'draft-model',
            effortLevel: 'high',
            prompt: '',
        });
        expect(mocks.events).toEqual(['spawn', 'space:agent-1', 'navigate']);
        hook.unmount();
    });

    it('stores an initial draft and runs beforeNavigate before space/navigation', async () => {
        const hook = renderHook();

        await act(async () => {
            await hook.current().enter(agent, {
                initialDraft: 'Preset prompt',
                beforeNavigate: () => mocks.events.push('before'),
            });
        });

        expect(mocks.updateSessionDraft).toHaveBeenCalledWith('session-1', 'Preset prompt');
        expect(mocks.events).toEqual(['spawn', 'draft', 'before', 'space:agent-1', 'navigate']);
        hook.unmount();
    });

    it.each([
        [{ type: 'cancelled' }],
        [{ type: 'error', message: 'spawn failed' }],
    ])('does not write space state or navigate when spawning returns %o', async (spawnResult) => {
        mocks.spawnSession.mockResolvedValue(spawnResult);
        const hook = renderHook();

        await act(async () => {
            await hook.current().enter(agent);
        });

        expect(mocks.setAgentSpaceId).not.toHaveBeenCalled();
        expect(mocks.updateSessionDraft).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        hook.unmount();
    });

    it('does not spawn, write space state, or navigate for an offline Agent machine', async () => {
        mocks.machines = [{ ...machine, active: false }];
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().enter(agent);
        });

        expect(result).toEqual({ type: 'error', message: 'newSession.machineOffline' });
        expect(mocks.spawnSession).not.toHaveBeenCalled();
        expect(mocks.setAgentSpaceId).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalledWith('common.error', 'newSession.machineOffline');
        hook.unmount();
    });

    it('restores the prior Agent space when synchronous navigation throws', async () => {
        mocks.navigateToSession.mockImplementation(() => {
            mocks.events.push('navigate');
            throw new Error('navigation failed');
        });
        const hook = renderHook();
        let result;

        await act(async () => {
            result = await hook.current().enter(agent);
        });

        expect(result).toEqual({ type: 'error', message: 'navigation failed' });
        expect(mocks.events).toEqual(['spawn', 'space:agent-1', 'navigate', 'space:previous-space']);
        expect(mocks.spawnSession).toHaveBeenCalledTimes(1);
        expect(mocks.alert).toHaveBeenCalledWith('common.error', 'agentSpace.enterFailed');
        hook.unmount();
    });

    it('ignores a concurrent second enter request', async () => {
        let resolveSpawn: ((value: { type: 'success'; sessionId: string }) => void) | undefined;
        mocks.spawnSession.mockImplementation(() => new Promise((resolve) => {
            resolveSpawn = resolve;
        }));
        const hook = renderHook();
        let first: Promise<unknown>;
        let second: Promise<unknown>;

        act(() => {
            first = hook.current().enter(agent);
            second = hook.current().enter(agent);
        });

        await expect(second!).resolves.toEqual({ type: 'busy' });
        expect(mocks.spawnSession).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveSpawn?.({ type: 'success', sessionId: 'session-1' });
            await first!;
        });
        hook.unmount();
    });

    it('does not finish a pending entry after the coordinator unmounts', async () => {
        let resolveSpawn: ((value: { type: 'success'; sessionId: string }) => void) | undefined;
        mocks.spawnSession.mockImplementation(() => new Promise((resolve) => {
            resolveSpawn = resolve;
        }));
        const beforeNavigate = vi.fn();
        const hook = renderHook();
        let entry: Promise<unknown>;

        act(() => {
            entry = hook.current().enter(agent, { initialDraft: 'Preset', beforeNavigate });
        });
        expect(mocks.spawnSession).toHaveBeenCalledTimes(1);
        hook.unmount();

        await act(async () => {
            resolveSpawn?.({ type: 'success', sessionId: 'session-1' });
            await entry!;
        });

        expect(mocks.updateSessionDraft).not.toHaveBeenCalled();
        expect(beforeNavigate).not.toHaveBeenCalled();
        expect(mocks.setAgentSpaceId).not.toHaveBeenCalled();
        expect(mocks.navigateToSession).not.toHaveBeenCalled();
    });
});
