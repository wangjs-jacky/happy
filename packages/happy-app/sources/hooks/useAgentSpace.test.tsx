import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentLauncher } from '@/components/agents/launchAgent';
import type { Machine, Session } from '@/sync/storageTypes';
import { useSpaceAgentForSession } from './useAgentSpace';

// react-test-renderer does not publish TypeScript declarations with the package.
// @ts-expect-error The test only needs the small create/unmount surface typed below.
import TestRenderer from 'react-test-renderer';

const mockedStorage = vi.hoisted(() => ({
    agents: [] as AgentLauncher[],
    agentSpaceId: null as string | null,
    machines: [] as Machine[],
}));
const originalConsoleError = console.error;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

vi.mock('@/sync/storage', () => ({
    useAllMachines: () => mockedStorage.machines,
    useLocalSetting: (name: 'agents' | 'agentSpaceId') => mockedStorage[name],
    useLocalSettingMutable: (name: 'agents' | 'agentSpaceId') => [mockedStorage[name], vi.fn()],
}));

function makeAgent(overrides: Partial<AgentLauncher> = {}): AgentLauncher {
    return {
        id: 'agent-1',
        name: 'Agent',
        glyph: 'A',
        color: '#5e5791',
        machineId: 'm1',
        path: '~/work',
        kind: 'standard',
        spaceType: 'default',
        imageStyleIds: [],
        imageVariantsPerStyle: 1,
        presets: [],
        ...overrides,
    };
}

function makeMachine(homeDir: string): Machine {
    return {
        id: 'm1',
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
            homeDir,
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

function makeSession(path: string): Session {
    return {
        id: 'session-1',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: { path, host: 'mac', machineId: 'm1' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        presence: 'online',
    };
}

function renderHook(session: Session): AgentLauncher | null {
    let result: AgentLauncher | null = null;

    function HookHarness() {
        result = useSpaceAgentForSession(session);
        return null;
    }

    let renderer: { unmount: () => void } | undefined;
    act(() => {
        renderer = TestRenderer.create(React.createElement(HookHarness));
    });
    act(() => renderer?.unmount());
    return result;
}

describe('useSpaceAgentForSession', () => {
    beforeEach(() => {
        mockedStorage.agents = [];
        mockedStorage.agentSpaceId = null;
        mockedStorage.machines = [makeMachine('/Users/jacky')];
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            if (args[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') {
                return;
            }
            originalConsoleError(...args);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('matches a tilde Agent path to the canonical session path', () => {
        const agent = makeAgent();
        mockedStorage.agents = [agent];

        expect(renderHook(makeSession('/Users/jacky/work'))).toBe(agent);
    });

    it('returns null for ambiguous canonical matches without a matching agentSpaceId', () => {
        mockedStorage.agents = [
            makeAgent({ id: 'first', path: '~/work' }),
            makeAgent({ id: 'second', path: '/Users/jacky/work/' }),
        ];

        expect(renderHook(makeSession('/Users/jacky/work'))).toBeNull();
    });
});
