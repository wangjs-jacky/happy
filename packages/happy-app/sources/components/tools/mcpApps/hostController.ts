import type { McpAppPresentationV1, McpAppResultV1 } from '@slopus/happy-wire';
import {
    McpAppHostError,
    type McpAppFrame,
    type McpAppFrameAdapter,
    type McpAppHostContext,
    type McpAppRemotePort,
    type McpAppToolResult,
} from './types';

export const MCP_APP_SANDBOX_READY_TIMEOUT_MS = 10_000;
export const MCP_APP_INITIALIZE_TIMEOUT_MS = 10_000;

export type McpAppHostState =
    | { type: 'fallback' }
    | { type: 'waiting-for-origin' }
    | { type: 'loading-resource' }
    | { type: 'loading-sandbox' }
    | { type: 'initializing' }
    | { type: 'active' }
    | { type: 'failed'; error: McpAppHostError };

export type McpAppToolCallUpdate = {
    state: 'running' | 'completed' | 'error' | 'cancelled';
    result?: McpAppResultV1;
    cancellationReason?: string;
};

type PendingDelivery =
    | { type: 'result'; result: McpAppToolResult }
    | { type: 'cancelled'; reason: string };

function safeInternalError(): McpAppHostError {
    return new McpAppHostError(
        'MCP_APP_INTERNAL',
        true,
        'The App could not be loaded.',
    );
}

function cancellationError(): McpAppHostError {
    return new McpAppHostError(
        'MCP_APP_SESSION_OFFLINE',
        true,
        'The session is no longer available.',
    );
}

function timeoutError(): McpAppHostError {
    return new McpAppHostError('MCP_APP_TIMEOUT', true, 'The App request timed out.');
}

function normalizeError(error: unknown): McpAppHostError {
    return error instanceof McpAppHostError ? error : safeInternalError();
}

function availableResult(result: McpAppResultV1, isError: boolean): McpAppToolResult | undefined {
    if (result.state !== 'available') return undefined;
    return {
        content: result.content,
        ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
        ...(result._meta !== undefined ? { _meta: result._meta } : {}),
        ...(isError ? { isError: true } : {}),
    };
}

function abortReason(signal: AbortSignal): McpAppHostError {
    return signal.reason instanceof McpAppHostError ? signal.reason : cancellationError();
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(abortReason(signal));
    let remove = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(abortReason(signal));
        signal.addEventListener('abort', onAbort, { once: true });
        remove = () => signal.removeEventListener('abort', onAbort);
    });
    return Promise.race([promise, aborted]).finally(remove);
}

function createStageDeadline(controller: AbortController) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return {
        arm(timeoutMs: number): void {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => controller.abort(timeoutError()), timeoutMs);
        },
        clear(): void {
            if (timer) clearTimeout(timer);
            timer = undefined;
        },
    };
}

export function createMcpAppHostController(options: {
    callId: string;
    presentation: McpAppPresentationV1;
    input: Record<string, unknown>;
    result?: McpAppResultV1;
    hostContext: McpAppHostContext;
    remotePort: McpAppRemotePort;
    frameAdapter: McpAppFrameAdapter;
    onStateChange?: (state: McpAppHostState) => void;
}) {
    let state: McpAppHostState = { type: 'fallback' };
    let hostContext = options.hostContext;
    let currentResult = options.result;
    let pendingDelivery: PendingDelivery | undefined = currentResult?.state === 'available'
        ? { type: 'result', result: availableResult(currentResult, false)! }
        : undefined;
    let frame: McpAppFrame | undefined;
    let activeController: AbortController | undefined;
    let loadPromise: Promise<void> | undefined;
    let disposed = false;
    let started = false;
    let generation = 0;
    let originRetryUsed = false;
    let userRetryUsed = false;
    let inputSent = false;
    let terminalSent = false;
    const resultIsUnavailable = (): boolean => currentResult?.state === 'unavailable';

    const setState = (next: McpAppHostState): void => {
        state = next;
        options.onStateChange?.(next);
    };

    const teardownFrame = async (): Promise<void> => {
        const ownedFrame = frame;
        frame = undefined;
        if (ownedFrame) {
            try {
                await ownedFrame.teardown();
            } catch {
                // Teardown is best-effort; the adapter must still release its outer frame.
            }
        }
        activeController?.abort(cancellationError());
        activeController = undefined;
        inputSent = false;
        terminalSent = false;
    };

    const deliverPending = (): void => {
        if (!frame || terminalSent || !pendingDelivery) return;
        if (pendingDelivery.type === 'result') {
            frame.sendToolResult(pendingDelivery.result);
        } else {
            frame.sendToolCancelled(pendingDelivery.reason);
        }
        terminalSent = true;
    };

    const runLoad = async (): Promise<void> => {
        if (disposed || resultIsUnavailable()) return;
        const ownedGeneration = ++generation;
        const operation = new AbortController();
        activeController = operation;
        let mountPromise: Promise<McpAppFrame> | undefined;
        let mountAccepted = false;
        const deadline = createStageDeadline(operation);
        try {
            setState({ type: 'loading-resource' });
            const resource = await raceAbort(options.remotePort.readResource({
                callId: options.callId,
                expectedResourceUri: options.presentation.resourceUri,
                signal: operation.signal,
            }), operation.signal);
            if (disposed || ownedGeneration !== generation) return;

            setState({ type: 'loading-sandbox' });
            deadline.arm(MCP_APP_SANDBOX_READY_TIMEOUT_MS);
            mountPromise = options.frameAdapter.mount({
                resource,
                context: hostContext,
                signal: operation.signal,
                onSandboxReady: () => {
                    if (disposed || ownedGeneration !== generation || operation.signal.aborted
                        || state.type !== 'loading-sandbox') return;
                    setState({ type: 'initializing' });
                    deadline.arm(MCP_APP_INITIALIZE_TIMEOUT_MS);
                },
            });
            const mounted = await raceAbort(mountPromise, operation.signal);
            mountAccepted = true;
            deadline.clear();
            if (disposed || ownedGeneration !== generation || resultIsUnavailable()) {
                await mounted.teardown();
                return;
            }
            if (state.type !== 'initializing') {
                await mounted.teardown();
                throw new McpAppHostError(
                    'MCP_APP_BRIDGE_PROTOCOL',
                    false,
                    'The App bridge protocol failed.',
                );
            }

            frame = mounted;
            inputSent = false;
            terminalSent = false;
            frame.sendToolInput(options.input);
            inputSent = true;
            deliverPending();
            setState({ type: 'active' });
        } catch (caught) {
            deadline.clear();
            if (mountPromise && !mountAccepted) {
                void mountPromise.then((lateFrame) => lateFrame.teardown()).catch(() => {});
            }
            if (disposed || ownedGeneration !== generation) return;
            const error = normalizeError(caught);
            if (error.code === 'MCP_APP_ORIGIN_MISMATCH' && error.retryable && !originRetryUsed) {
                operation.abort(error);
                if (activeController === operation) activeController = undefined;
                setState({ type: 'waiting-for-origin' });
                return;
            }
            await teardownFrame();
            setState({ type: 'failed', error });
        } finally {
            deadline.clear();
            if (!frame && activeController === operation) {
                operation.abort(cancellationError());
                activeController = undefined;
            }
        }
    };

    const load = async (): Promise<void> => {
        if (disposed || loadPromise) return loadPromise;
        const pending = runLoad();
        loadPromise = pending;
        try {
            await pending;
        } finally {
            if (loadPromise === pending) loadPromise = undefined;
        }
    };

    return {
        getState(): McpAppHostState {
            return state;
        },

        async start(): Promise<void> {
            if (disposed || started) return;
            started = true;
            if (resultIsUnavailable()) return;
            await load();
        },

        async updateToolCall(update: McpAppToolCallUpdate): Promise<void> {
            if (disposed) return;
            if (update.result) currentResult = update.result;
            if (resultIsUnavailable()) {
                generation += 1;
                await teardownFrame();
                if (!disposed) setState({ type: 'fallback' });
                return;
            }

            if (update.result?.state === 'available') {
                pendingDelivery = {
                    type: 'result',
                    result: availableResult(update.result, update.state === 'error')!,
                };
            } else if (update.state === 'cancelled') {
                pendingDelivery = {
                    type: 'cancelled',
                    reason: update.cancellationReason ?? 'The tool call was cancelled.',
                };
            }

            if (frame && inputSent) {
                try {
                    deliverPending();
                } catch (caught) {
                    await teardownFrame();
                    if (!disposed) setState({ type: 'failed', error: normalizeError(caught) });
                }
            }

            const terminal = update.state === 'completed' || update.state === 'error'
                || update.state === 'cancelled';
            if (terminal && state.type === 'waiting-for-origin' && !originRetryUsed) {
                originRetryUsed = true;
                await load();
            }
        },

        updateHostContext(next: McpAppHostContext): void {
            if (disposed) return;
            hostContext = next;
            frame?.updateHostContext(next);
        },

        async retry(): Promise<void> {
            if (disposed || userRetryUsed || state.type !== 'failed' || !state.error.retryable) return;
            userRetryUsed = true;
            await load();
        },

        async dispose(): Promise<void> {
            if (disposed) return;
            disposed = true;
            generation += 1;
            await teardownFrame();
            setState({ type: 'fallback' });
        },
    };
}
