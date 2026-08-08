import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiMachineClient } from './apiMachine';
import { decodeBase64, decrypt, encodeBase64, encrypt } from './encryption';
import type { DaemonState, Machine, SystemHealthSnapshot } from './types';

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
        currentCliVersion: 'test'
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

vi.mock('@/api/rpc/RpcHandlerManager', () => ({
    RpcHandlerManager: class {
        onSocketConnect = vi.fn();
        onSocketDisconnect = vi.fn();
        handleRequest = vi.fn(async () => '');
        hasHandler = vi.fn(() => false);
        registerHandler = vi.fn();
        unregisterHandler = vi.fn();
    }
}));

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

function encryptedState(machine: Machine, state: DaemonState): string {
    return encodeBase64(encrypt(machine.encryptionKey, machine.encryptionVariant, state));
}

function decryptedState(machine: Machine, value: string): DaemonState {
    return decrypt(machine.encryptionKey, machine.encryptionVariant, decodeBase64(value));
}

function makeCodexUsage(codexHome: string): NonNullable<DaemonState['codexUsage']> {
    return {
        source: 'codex-session-jsonl',
        codexHome,
        sessionsDir: `${codexHome}/sessions`,
        timeZone: 'Asia/Shanghai',
        scannedAt: 1,
        today: null,
        yesterday: null,
        days: [],
        latestEvent: null,
        warnings: [],
    };
}

function makeHealthSnapshot(updatedAt: number): SystemHealthSnapshot {
    return {
        schemaVersion: 1,
        platform: 'darwin',
        updatedAt,
        lastAttemptAt: updatedAt,
        resourceStatus: 'healthy',
        issues: [],
        current: null,
        history: [],
        collector: {
            intervalSeconds: 15,
            historyStepSeconds: 60,
            durationMs: 1,
            lastSampleKind: 'complete',
            errors: [],
        },
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
            timeout: vi.fn(() => mockSocket),
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

    it('serializes socket writes and publishes only the latest queued health snapshot', async () => {
        const machine = makeMachine();
        machine.daemonState = {
            status: 'running',
            pid: 41,
            httpPort: 4242,
            startedAt: 100,
            codexUsage: makeCodexUsage('/usage'),
        };
        const pending: Array<{
            data: { daemonState: string; expectedVersion: number };
            resolve: (answer: unknown) => void;
        }> = [];
        let concurrent = 0;
        let maxConcurrent = 0;
        mockSocket.emitWithAck.mockImplementation((_event: string, data: { daemonState: string; expectedVersion: number }) => {
            concurrent += 1;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            return new Promise((resolve) => pending.push({
                data,
                resolve: (answer) => {
                    concurrent -= 1;
                    resolve(answer);
                },
            }));
        });

        const client = new ApiMachineClient('fake-token', machine);
        client.connect();
        mockSocket.connected = true;
        emitSocketEvent('connect');
        const ordinary = client.updateDaemonState((state) => ({ ...state!, shutdownRequestedAt: 999 }));
        client.publishSystemHealth(makeHealthSnapshot(1));
        client.publishSystemHealth(makeHealthSnapshot(2));

        expect(pending).toHaveLength(1);
        pending[0].resolve({ result: 'success', version: 1, daemonState: pending[0].data.daemonState });
        await vi.waitFor(() => expect(pending).toHaveLength(2));
        pending[1].resolve({ result: 'success', version: 2, daemonState: pending[1].data.daemonState });
        await ordinary;
        await vi.waitFor(() => expect(pending).toHaveLength(3));
        const healthState = decryptedState(machine, pending[2].data.daemonState);
        expect(healthState.systemHealth?.updatedAt).toBe(2);
        expect(healthState).toEqual(expect.objectContaining({
            pid: process.pid,
            httpPort: 4242,
            shutdownRequestedAt: 999,
            codexUsage: makeCodexUsage('/usage'),
        }));
        pending[2].resolve({ result: 'success', version: 3, daemonState: pending[2].data.daemonState });
        await vi.waitFor(() => expect(machine.daemonStateVersion).toBe(3));

        expect(maxConcurrent).toBe(1);
        expect(mockSocket.timeout).toHaveBeenCalledWith(5_000);
        client.shutdown();
    });

    it('absorbs CAS mismatch state before reapplying a pure patch', async () => {
        const machine = makeMachine();
        machine.daemonState = { status: 'running', pid: 1, httpPort: 2, startedAt: 3 };
        const serverState: DaemonState = {
            status: 'running',
            pid: 101,
            httpPort: 202,
            startedAt: 303,
            codexUsage: makeCodexUsage('/server-usage'),
        };
        const requests: Array<{ daemonState: string; expectedVersion: number }> = [];
        mockSocket.emitWithAck.mockImplementation(async (_event: string, data: { daemonState: string; expectedVersion: number }) => {
            requests.push(data);
            if (requests.length === 1) {
                return { result: 'success', version: 1, daemonState: data.daemonState };
            }
            if (requests.length === 2) {
                return { result: 'version-mismatch', version: 2, daemonState: encryptedState(machine, serverState) };
            }
            return { result: 'success', version: 3, daemonState: data.daemonState };
        });

        const client = new ApiMachineClient('fake-token', machine);
        const connected = new Promise<void>((resolve) => client.setConnectionListener((value) => {
            if (value) resolve();
        }));
        client.connect();
        mockSocket.connected = true;
        emitSocketEvent('connect');
        await connected;

        await client.updateDaemonState((state) => ({ ...state!, status: 'shutting-down', shutdownSource: 'cli' }));
        const retriedState = decryptedState(machine, requests[2].daemonState);
        expect(requests.map((request) => request.expectedVersion)).toEqual([0, 1, 2]);
        expect(retriedState).toEqual({
            ...serverState,
            status: 'shutting-down',
            shutdownSource: 'cli',
        });
        expect(machine.daemonState).toEqual(retriedState);
        expect(machine.daemonStateVersion).toBe(3);
        client.shutdown();
    });

    it('adopts an older server version from a valid CAS mismatch before retrying', async () => {
        const machine = makeMachine();
        machine.daemonState = { status: 'running', pid: 1, httpPort: 2, startedAt: 3 };
        const serverState: DaemonState = {
            status: 'running',
            pid: 401,
            httpPort: 402,
            startedAt: 403,
            codexUsage: makeCodexUsage('/older-server-state'),
        };
        const requests: Array<{ daemonState: string; expectedVersion: number }> = [];
        mockSocket.emitWithAck.mockImplementation(async (_event: string, data: { daemonState: string; expectedVersion: number }) => {
            requests.push(data);
            if (requests.length === 1) {
                return { result: 'success', version: 1, daemonState: data.daemonState };
            }
            if (requests.length === 2) {
                return { result: 'version-mismatch', version: 4, daemonState: encryptedState(machine, serverState) };
            }
            return { result: 'success', version: 5, daemonState: data.daemonState };
        });

        const client = new ApiMachineClient('fake-token', machine);
        const connected = new Promise<void>((resolve) => client.setConnectionListener((value) => {
            if (value) resolve();
        }));
        client.connect();
        mockSocket.connected = true;
        emitSocketEvent('connect');
        await connected;
        machine.daemonStateVersion = 7;
        machine.daemonState = {
            status: 'running',
            pid: 701,
            httpPort: 702,
            startedAt: 703,
            codexUsage: makeCodexUsage('/newer-local-state'),
        };

        await client.updateDaemonState((state) => ({ ...state!, status: 'shutting-down', shutdownSource: 'cli' }));
        const retriedState = decryptedState(machine, requests[2].daemonState);
        expect(requests.map((request) => request.expectedVersion)).toEqual([0, 7, 4]);
        expect(retriedState).toEqual({
            ...serverState,
            status: 'shutting-down',
            shutdownSource: 'cli',
        });
        expect(machine.daemonState).toEqual(retriedState);
        expect(machine.daemonStateVersion).toBe(5);
        client.shutdown();
    });

    it('does not apply a shutdown ACK that arrives after close timed out', async () => {
        vi.useFakeTimers();
        const machine = makeMachine();
        machine.daemonState = { status: 'running', pid: 1 };
        mockSocket.emitWithAck.mockImplementation(async (_event: string, data: { daemonState: string }) => ({
            result: 'success',
            version: 1,
            daemonState: data.daemonState,
        }));

        const client = new ApiMachineClient('fake-token', machine);
        const connected = new Promise<void>((resolve) => client.setConnectionListener((value) => {
            if (value) resolve();
        }));
        client.connect();
        mockSocket.connected = true;
        emitSocketEvent('connect');
        await connected;

        let resolveLateAck!: (answer: unknown) => void;
        mockSocket.emitWithAck.mockImplementationOnce((_event: string, data: { daemonState: string }) => new Promise((resolve) => {
            resolveLateAck = resolve;
        }));
        const closing = client.close((state) => ({ ...state!, status: 'shutting-down' }));
        await vi.advanceTimersByTimeAsync(1_000);
        await closing;
        resolveLateAck({
            result: 'success',
            version: 99,
            daemonState: encryptedState(machine, { status: 'shutting-down', pid: 999 }),
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(machine.daemonStateVersion).toBe(1);
        expect(machine.daemonState).toEqual(expect.objectContaining({ status: 'running' }));
    });
});
