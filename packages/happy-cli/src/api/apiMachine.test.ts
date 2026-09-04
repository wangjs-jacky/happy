import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiMachineClient } from './apiMachine';
import type { Machine } from './types';
import type { ComponentObservation } from '@slopus/happy-wire';
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
import { createProcessRunner } from '@/environment/processRunner';
import { createGitHubCliAdapter } from '@/environment/githubCliAdapter';
import { createEnvironmentService } from '@/environment/environmentService';
import { registerEnvironmentHandlers } from '@/environment/registerEnvironmentHandlers';

const {
    mockIo,
    mockShouldReconnect
} = vi.hoisted(() => ({
    mockIo: vi.fn(),
    mockShouldReconnect: vi.fn(() => true)
}));

vi.mock('socket.io-client', () => ({
    io: mockIo
}));

vi.mock('@/configuration', () => ({
    configuration: {
        serverUrl: 'http://127.0.0.1:3005',
        currentCliVersion: 'test',
        happyHomeDir: '/tmp/happy-api-machine-test'
    }
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        debugLargeJson: vi.fn()
    }
}));

vi.mock('@/modules/common/registerCommonHandlers', () => ({
    registerCommonHandlers: vi.fn()
}));

vi.mock('@/environment/processRunner', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/environment/processRunner')>(),
    createProcessRunner: vi.fn(() => ({ run: vi.fn(async () => { throw new Error('No processes in machine RPC tests'); }) })),
}));

vi.mock('@/environment/githubCliAdapter', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/environment/githubCliAdapter')>();
    return {
        ...actual,
        createGitHubCliAdapter: vi.fn((deps: Parameters<typeof actual.createGitHubCliAdapter>[0]) => {
            let state: ComponentObservation = {
                componentId: 'github-cli', platform: 'darwin', architecture: 'arm64', support: 'supported',
                installed: true, installedVersion: '2.79.0', resolvedExecutable: '/opt/homebrew/bin/gh',
                packageManager: { kind: 'homebrew', available: true, stableVersion: '2.80.0' },
                authentication: { provider: 'github.com', status: 'authenticated' }, inspectedAt: Date.now(),
            };
            return {
                id: 'github-cli',
                inspect: async () => structuredClone(state),
                plan: actual.createGitHubCliAdapter(deps).plan,
                apply: async () => {
                    state = { ...state, installedVersion: '2.80.0' };
                    return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
                },
            };
        }),
    };
});

vi.mock('@/environment/environmentService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/environment/environmentService')>();
    return { ...actual, createEnvironmentService: vi.fn(actual.createEnvironmentService) };
});

vi.mock('@/environment/registerEnvironmentHandlers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/environment/registerEnvironmentHandlers')>();
    return { ...actual, registerEnvironmentHandlers: vi.fn(actual.registerEnvironmentHandlers) };
});

vi.mock('@/utils/detectCLI', () => ({
    detectCLIAvailability: vi.fn(() => ({
        ask: true,
        claude: false,
        codex: false,
        gemini: false,
        opencode: false,
        openclaw: false
    }))
}));

vi.mock('@/resume/localHappyAgentAuth', () => ({
    detectResumeSupport: vi.fn(() => ({
        rpcAvailable: false,
        requiresSameMachine: false,
        requiresHappyAgentAuth: false,
        happyAgentAuthenticated: false
    }))
}));

vi.mock('@/utils/lidState', () => ({
    shouldReconnect: mockShouldReconnect
}));

type SocketHandler = (...args: any[]) => void;
type SocketHandlers = Record<string, SocketHandler[]>;

function makeMachine(): Machine {
    return {
        id: 'test-machine-id',
        metadata: {
            host: 'localhost',
            platform: 'darwin',
            happyCliVersion: 'test',
            homeDir: '/home/user',
            happyHomeDir: '/home/user/.happy',
            happyLibDir: '/home/user/.happy/lib'
        },
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
        encryptionKey: new Uint8Array(32),
        encryptionVariant: 'legacy'
    };
}

describe('ApiMachineClient socket reconnection', () => {
    let socketHandlers: SocketHandlers;
    let mockSocket: any;

    const emitSocketEvent = (event: string, ...args: any[]) => {
        const handlers = socketHandlers[event] || [];
        handlers.forEach((handler) => handler(...args));
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockShouldReconnect.mockReturnValue(true);
        socketHandlers = {};
        mockSocket = {
            connected: false,
            connect: vi.fn(),
            on: vi.fn((event: string, handler: SocketHandler) => {
                if (!socketHandlers[event]) {
                    socketHandlers[event] = [];
                }
                socketHandlers[event].push(handler);
            }),
            emit: vi.fn(),
            emitWithAck: vi.fn(),
            close: vi.fn(),
            io: {
                on: vi.fn()
            }
        };

        mockIo.mockReturnValue(mockSocket);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('retries after initial socket connection error', async () => {
        vi.useFakeTimers();

        const client = new ApiMachineClient('fake-token', makeMachine());
        client.connect();

        expect(mockIo).toHaveBeenCalledWith('ws://127.0.0.1:3005', expect.objectContaining({
            reconnection: false
        }));
        expect(mockSocket.connect).not.toHaveBeenCalled();

        emitSocketEvent('connect_error', new Error('ECONNREFUSED'));

        await vi.advanceTimersByTimeAsync(1000);
        expect(mockSocket.connect).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(3000);
        expect(mockSocket.connect).toHaveBeenCalledTimes(2);

        client.shutdown();
    });

    it('retains daemon-issued environment previews across socket reconnects', async () => {
        vi.useFakeTimers();
        const machine = makeMachine();
        const client = new ApiMachineClient('fake-token', machine);
        vi.spyOn(client, 'updateDaemonState').mockResolvedValue(undefined);
        client.connect();

        const callRpc = (method: string, raw: unknown): Promise<any> => new Promise((resolve) => {
            emitSocketEvent('rpc-request', {
                method: `${machine.id}:${method}`,
                params: encodeBase64(encrypt(machine.encryptionKey, machine.encryptionVariant, raw)),
            }, (response: string) => resolve(decrypt(machine.encryptionKey, machine.encryptionVariant, decodeBase64(response))));
        });

        try {
            mockSocket.connected = true;
            emitSocketEvent('connect');
            expect(mockSocket.emit.mock.calls.filter(([event]: [string]) => event === 'rpc-register')).toEqual([
                ['rpc-register', { method: 'test-machine-id:environment-inspect' }],
                ['rpc-register', { method: 'test-machine-id:environment-apply' }],
            ]);
            const desired = { componentId: 'github-cli', targetVersion: '2.80.0' };
            const preview = await callRpc('environment-inspect', { componentIds: ['github-cli'], desired });
            expect(preview.plans[0].action).toBe('upgrade');
            const approvedAt = Date.now();

            mockSocket.connected = false;
            emitSocketEvent('disconnect', 'transport close');
            await vi.advanceTimersByTimeAsync(1000);
            expect(mockSocket.connect).toHaveBeenCalledOnce();
            mockSocket.connected = true;
            emitSocketEvent('connect');

            const response = await callRpc('environment-apply', { desired, plan: preview.plans[0], approvedAt });
            expect(response.result).toMatchObject({
                status: 'succeeded', changed: true, after: { installedVersion: '2.80.0' },
            });
            expect(mockSocket.emit.mock.calls.filter(([event]: [string]) => event === 'rpc-register')).toHaveLength(4);
            expect(registerEnvironmentHandlers).toHaveBeenCalledOnce();
            const registration = vi.mocked(registerEnvironmentHandlers).mock.calls[0]!;
            expect(typeof registration[0].registerHandler).toBe('function');
            // Chai treats an object's inspect() as a formatter; compare identity without formatting the service.
            expect(registration[1] === vi.mocked(createEnvironmentService).mock.results[0]?.value).toBe(true);
            expect(createEnvironmentService).toHaveBeenCalledOnce();
            expect(createProcessRunner).toHaveBeenCalledOnce();
            expect(createGitHubCliAdapter).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                runner: vi.mocked(createProcessRunner).mock.results[0]?.value,
                env: process.env, platform: process.platform, architecture: process.arch,
                resolveExecutable: expect.any(Function), resolveRealpath: expect.any(Function), now: expect.any(Function),
            }));
        } finally {
            client.shutdown();
        }
    });
});
