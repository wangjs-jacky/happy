import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpAppPresentationV1, McpAppResultV1 } from '@slopus/happy-wire';
import {
    MCP_APP_INITIALIZE_TIMEOUT_MS,
    MCP_APP_SANDBOX_READY_TIMEOUT_MS,
    createMcpAppHostController,
} from './hostController';
import {
    McpAppHostError,
    type FrameMountInput,
    type McpAppFrame,
    type McpAppFrameAdapter,
    type McpAppHostContext,
    type McpAppRemotePort,
    type McpAppResource,
} from './types';

const presentation: McpAppPresentationV1 = {
    version: 1,
    server: 'demo',
    resourceUri: 'ui://demo/index.html',
};

const context: McpAppHostContext = {
    theme: 'light',
    locale: 'en',
    platform: 'web',
    touch: false,
    hover: true,
    container: { width: 640, height: 320 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    displayMode: 'inline',
};

const resource: McpAppResource = {
    resourceId: 'resource-1',
    uri: presentation.resourceUri,
    mimeType: 'text/html;profile=mcp-app',
    byteLength: 14,
    sha256: '4db7ef630005c462450ea587722b1a7cff53dfdcd35d7dd40bcf8e97e50826ee',
    encoding: 'utf8',
    html: '<h1>hello</h1>',
};

const availableResult: McpAppResultV1 = {
    version: 1,
    state: 'available',
    content: [{ type: 'text', text: 'done' }],
    structuredContent: { ok: true },
    _meta: { view: 'safe-only-inside-frame' },
};

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

class MemoryRemotePort implements McpAppRemotePort {
    reads = 0;
    readonly readInputs: unknown[] = [];

    constructor(private readonly read: () => Promise<McpAppResource>) {}

    async readResource(input: unknown): Promise<McpAppResource> {
        this.reads += 1;
        this.readInputs.push(input);
        return this.read();
    }

    async callTool(): Promise<never> {
        throw new McpAppHostError('MCP_APP_UNSUPPORTED', false, 'unsupported');
    }
}

class MemoryFrame implements McpAppFrame {
    constructor(private readonly events: string[]) {}

    sendToolInput(input: Record<string, unknown>): void {
        this.events.push(`input:${JSON.stringify(input)}`);
    }

    sendToolResult(result: { content: unknown[] }): void {
        this.events.push(`result:${JSON.stringify(result.content)}`);
    }

    sendToolCancelled(reason: string): void {
        this.events.push(`cancel:${reason}`);
    }

    updateHostContext(next: McpAppHostContext): void {
        this.events.push(`context:${next.theme}`);
    }

    async teardown(): Promise<void> {
        this.events.push('teardown');
    }
}

class MemoryFrameAdapter implements McpAppFrameAdapter {
    mounts = 0;

    constructor(
        private readonly events: string[],
        private readonly initialize: (input: FrameMountInput) => Promise<void> = async () => {},
    ) {}

    async mount(input: FrameMountInput): Promise<McpAppFrame> {
        this.mounts += 1;
        this.events.push(`mount:${input.resource.html}`);
        input.onSandboxReady();
        this.events.push('sandbox-ready');
        await this.initialize(input);
        this.events.push('initialized');
        return new MemoryFrame(this.events);
    }
}

function makeController(options: {
    remotePort?: McpAppRemotePort;
    frameAdapter?: McpAppFrameAdapter;
    result?: McpAppResultV1;
    events?: string[];
}) {
    const events = options.events ?? [];
    const remotePort = options.remotePort ?? new MemoryRemotePort(async () => {
        events.push('resource-verified');
        return resource;
    });
    const frameAdapter = options.frameAdapter ?? new MemoryFrameAdapter(events);
    const controller = createMcpAppHostController({
        callId: 'call-1',
        presentation,
        input: { city: 'Hangzhou' },
        result: options.result,
        hostContext: context,
        remotePort,
        frameAdapter,
        onStateChange: (state) => events.push(`state:${state.type}`),
    });
    return { controller, events, remotePort, frameAdapter };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('MCP App host controller', () => {
    it('enforces resource, sandbox, initialize, input, buffered result, active ordering', async () => {
        const { controller, events } = makeController({ result: availableResult });

        await controller.start();

        expect(events).toEqual([
            'state:loading-resource',
            'resource-verified',
            'state:loading-sandbox',
            'mount:<h1>hello</h1>',
            'state:initializing',
            'sandbox-ready',
            'initialized',
            'input:{"city":"Hangzhou"}',
            'result:[{"type":"text","text":"done"}]',
            'state:active',
        ]);
        expect(controller.getState()).toEqual({ type: 'active' });
    });

    it('buffers cancellation until initialization and sends input first', async () => {
        const gate = deferred<void>();
        const events: string[] = [];
        const adapter = new MemoryFrameAdapter(events, async () => gate.promise);
        const { controller } = makeController({ events, frameAdapter: adapter });
        const starting = controller.start();
        await Promise.resolve();
        await Promise.resolve();

        controller.updateToolCall({ state: 'cancelled', cancellationReason: 'Stopped by user' });
        gate.resolve();
        await starting;

        expect(events.filter((event) => (
            event === 'input:{"city":"Hangzhou"}' || event === 'cancel:Stopped by user'
        ))).toEqual([
            'input:{"city":"Hangzhou"}',
            'cancel:Stopped by user',
        ]);
        expect(events.filter((event) => event.startsWith('cancel:'))).toEqual(['cancel:Stopped by user']);
    });

    it('delivers repeated terminal result or cancellation updates at most once after activation', async () => {
        const resultEvents: string[] = [];
        const { controller: resultController } = makeController({ events: resultEvents });
        await resultController.start();

        await resultController.updateToolCall({ state: 'completed', result: availableResult });
        await resultController.updateToolCall({ state: 'completed', result: availableResult });
        await resultController.updateToolCall({ state: 'cancelled', cancellationReason: 'late cancellation' });

        expect(resultEvents.filter((event) => (
            event.startsWith('result:') || event.startsWith('cancel:')
        ))).toEqual([
            'result:[{"type":"text","text":"done"}]',
        ]);

        const cancellationEvents: string[] = [];
        const { controller: cancellationController } = makeController({ events: cancellationEvents });
        await cancellationController.start();

        await cancellationController.updateToolCall({ state: 'cancelled', cancellationReason: 'Stopped by user' });
        await cancellationController.updateToolCall({ state: 'cancelled', cancellationReason: 'Stopped by user' });
        await cancellationController.updateToolCall({ state: 'completed', result: availableResult });

        expect(cancellationEvents.filter((event) => (
            event.startsWith('result:') || event.startsWith('cancel:')
        ))).toEqual([
            'cancel:Stopped by user',
        ]);
    });

    it('waits without polling and retries origin once only after a new terminal update', async () => {
        vi.useFakeTimers();
        let first = true;
        const remote = new MemoryRemotePort(async () => {
            if (first) {
                first = false;
                throw new McpAppHostError(
                    'MCP_APP_ORIGIN_MISMATCH',
                    true,
                    'Waiting for the trusted App origin.',
                );
            }
            return resource;
        });
        const { controller } = makeController({ remotePort: remote });

        await controller.start();
        expect(controller.getState()).toEqual({ type: 'waiting-for-origin' });
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(remote.reads).toBe(1);

        await controller.updateToolCall({ state: 'completed', result: availableResult });
        expect(remote.reads).toBe(2);
        expect(controller.getState()).toEqual({ type: 'active' });

        await controller.updateToolCall({ state: 'completed', result: availableResult });
        expect(remote.reads).toBe(2);
    });

    it('keeps an unavailable oversized result on static fallback', async () => {
        const remote = new MemoryRemotePort(async () => resource);
        const adapter = new MemoryFrameAdapter([]);
        const { controller } = makeController({
            remotePort: remote,
            frameAdapter: adapter,
            result: { version: 1, state: 'unavailable', code: 'MCP_APP_RESULT_TOO_LARGE' },
        });

        await controller.start();

        expect(controller.getState()).toEqual({ type: 'fallback' });
        expect(remote.reads).toBe(0);
        expect(adapter.mounts).toBe(0);
    });

    it('uses independent ten-second sandbox-ready and initialize deadlines', async () => {
        expect(MCP_APP_SANDBOX_READY_TIMEOUT_MS).toBe(10_000);
        expect(MCP_APP_INITIALIZE_TIMEOUT_MS).toBe(10_000);
        vi.useFakeTimers();
        const neverReady: McpAppFrameAdapter = {
            mount: async (input) => new Promise((_resolve, reject) => {
                input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
            }),
        };
        const { controller } = makeController({ frameAdapter: neverReady });
        const starting = controller.start();
        await Promise.resolve();

        await vi.advanceTimersByTimeAsync(10_000);
        await starting;

        expect(controller.getState()).toMatchObject({
            type: 'failed',
            error: { code: 'MCP_APP_TIMEOUT', retryable: true },
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts a fresh ten-second deadline after sandbox ready', async () => {
        vi.useFakeTimers();
        const neverInitializes: McpAppFrameAdapter = {
            mount: async (input) => {
                input.onSandboxReady();
                return new Promise((_resolve, reject) => {
                    input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true });
                });
            },
        };
        const { controller } = makeController({ frameAdapter: neverInitializes });
        const starting = controller.start();
        await vi.advanceTimersByTimeAsync(0);

        expect(controller.getState()).toEqual({ type: 'initializing' });
        await vi.advanceTimersByTimeAsync(9_999);
        expect(controller.getState()).toEqual({ type: 'initializing' });
        await vi.advanceTimersByTimeAsync(1);
        await starting;

        expect(controller.getState()).toMatchObject({
            type: 'failed',
            error: { code: 'MCP_APP_TIMEOUT', retryable: true },
        });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('tears down frame state and ignores late async work after dispose', async () => {
        vi.useFakeTimers();
        const readGate = deferred<McpAppResource>();
        const remote = new MemoryRemotePort(async () => readGate.promise);
        const adapter = new MemoryFrameAdapter([]);
        const { controller } = makeController({ remotePort: remote, frameAdapter: adapter });
        const starting = controller.start();
        await Promise.resolve();

        await controller.dispose();
        readGate.resolve(resource);
        await starting;

        expect(controller.getState()).toEqual({ type: 'fallback' });
        expect(adapter.mounts).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('allows only one user retry for retryable failures', async () => {
        const remote = new MemoryRemotePort(async () => {
            throw new McpAppHostError('MCP_APP_SESSION_OFFLINE', true, 'offline');
        });
        const { controller } = makeController({ remotePort: remote });

        await controller.start();
        await controller.retry();
        await controller.retry();

        expect(remote.reads).toBe(2);
        expect(controller.getState()).toMatchObject({ type: 'failed' });
    });

    it('tears down the bridge before aborting adapter listeners on active disposal', async () => {
        vi.useFakeTimers();
        const events: string[] = [];
        const adapter: McpAppFrameAdapter = {
            async mount(input) {
                input.signal.addEventListener('abort', () => events.push('listener-aborted'), { once: true });
                input.onSandboxReady();
                return new MemoryFrame(events);
            },
        };
        const { controller } = makeController({ events, frameAdapter: adapter });
        await controller.start();

        await controller.dispose();

        expect(events.filter((event) => (
            event === 'teardown' || event === 'listener-aborted' || event === 'state:fallback'
        ))).toEqual([
            'teardown',
            'listener-aborted',
            'state:fallback',
        ]);
        expect(controller.getState()).toEqual({ type: 'fallback' });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('tears down and leaves active state when the mounted frame later fails', async () => {
        const events: string[] = [];
        let reportFailure: ((error: McpAppHostError) => void) | undefined;
        const adapter: McpAppFrameAdapter = {
            async mount(input) {
                input.onSandboxReady();
                reportFailure = input.onFailure;
                return new MemoryFrame(events);
            },
        };
        const { controller } = makeController({ events, frameAdapter: adapter });
        await controller.start();
        expect(controller.getState()).toEqual({ type: 'active' });
        expect(reportFailure).toEqual(expect.any(Function));

        reportFailure!(new McpAppHostError(
            'MCP_APP_BRIDGE_PROTOCOL', false, 'sensitive protocol detail',
        ));
        await vi.waitFor(() => expect(controller.getState()).toMatchObject({
            type: 'failed',
            error: { code: 'MCP_APP_BRIDGE_PROTOCOL', retryable: false },
        }));

        expect(events.filter((event) => event === 'teardown' || event === 'state:failed')).toEqual([
            'teardown',
            'state:failed',
        ]);
    });

    it('ignores a late frame failure after disposal', async () => {
        let reportFailure: ((error: McpAppHostError) => void) | undefined;
        const adapter: McpAppFrameAdapter = {
            async mount(input) {
                input.onSandboxReady();
                reportFailure = input.onFailure;
                return new MemoryFrame([]);
            },
        };
        const { controller } = makeController({ frameAdapter: adapter });
        await controller.start();
        await controller.dispose();

        reportFailure!(new McpAppHostError('MCP_APP_SANDBOX_UNAVAILABLE', true, 'late failure'));
        await Promise.resolve();

        expect(controller.getState()).toEqual({ type: 'fallback' });
    });
});
