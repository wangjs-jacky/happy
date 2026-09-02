import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { ErrorCode, McpError, PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
    MCP_APP_MAX_FRAME_HEIGHT,
    MCP_APP_MAX_BRIDGE_MESSAGE_BYTES,
    MCP_APP_MIN_FRAME_HEIGHT,
    hostContextSchema,
    mcpAppBridgeRequestSchema,
    nativeMessages,
    parseHostCommand,
    utf8ByteLength,
    type HostCommand,
    type McpAppBridgeRequest,
    type NativeMessage,
} from './protocol';

export * from './protocol';

export function createSandboxedIframe(ownerDocument: Document, html: string): HTMLIFrameElement {
    const iframe = ownerDocument.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent';
    iframe.srcdoc = html;
    return iframe;
}

export function createResizeEmitter(
    send: (height: number) => void,
    requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): (height: number) => void {
    let queued = false;
    let latest = MCP_APP_MIN_FRAME_HEIGHT;
    return (height: number) => {
        latest = Number.isFinite(height)
            ? Math.max(MCP_APP_MIN_FRAME_HEIGHT, Math.min(MCP_APP_MAX_FRAME_HEIGHT, height))
            : MCP_APP_MAX_FRAME_HEIGHT;
        if (queued) return;
        queued = true;
        requestFrame(() => {
            queued = false;
            send(latest);
        });
    };
}

type ShellWindow = Window & {
    ReactNativeWebView?: { postMessage(message: string): void };
};

function officialHostContext(context: z.infer<typeof hostContextSchema>) {
    return {
        theme: context.theme,
        locale: context.locale,
        platform: context.platform === 'desktop' ? 'desktop' as const : context.platform === 'web' ? 'web' as const : 'mobile' as const,
        deviceCapabilities: { touch: context.touch, hover: context.hover },
        containerDimensions: { width: context.container.width, height: context.container.height },
        safeAreaInsets: context.safeAreaInsets,
        displayMode: context.displayMode,
    };
}

type AppBridgeRequestExtra = Parameters<Parameters<AppBridge['setRequestHandler']>[1]>[1];

class PawsAppBridge extends AppBridge {
    replacePingHandler(
        handler: (
            request: z.infer<typeof PingRequestSchema>,
            extra: AppBridgeRequestExtra,
        ) => Promise<Record<string, never>>,
    ): void {
        this.replaceRequestHandler(PingRequestSchema, handler);
    }
}

/** Starts the browser-only shell. The inner opaque-origin View never receives the native bridge object. */
export function startHostShell(shellWindow: ShellWindow = window as ShellWindow): () => void {
    const native = shellWindow.ReactNativeWebView;
    if (!native) return () => {};

    // The official transport logs complete JSON-RPC envelopes by default. This
    // shell carries HTML, tool arguments/results, resource URIs, and App names,
    // so its isolated console must stay silent rather than becoming a data sink.
    const shellConsole = (shellWindow as Window & { console: Console }).console;
    const originalConsole = {
        debug: shellConsole.debug,
        info: shellConsole.info,
        log: shellConsole.log,
        warn: shellConsole.warn,
        error: shellConsole.error,
    };
    const silent = () => {};
    shellConsole.debug = silent;
    shellConsole.info = silent;
    shellConsole.log = silent;
    shellConsole.warn = silent;
    shellConsole.error = silent;

    let instanceId: string | undefined;
    let iframe: HTMLIFrameElement | undefined;
    let bridge: PawsAppBridge | undefined;
    let disposed = false;
    let nextRequestId = 0;
    const pendingBridgeRequests = new Map<string, {
        resolve(value: unknown): void;
        reject(error: Error): void;
        removeAbortListener(): void;
    }>();
    const abandonedBridgeRequestIds = new Set<string>();

    const rememberAbandonedRequest = (requestId: string): void => {
        while (abandonedBridgeRequestIds.size >= 64) {
            const oldest = abandonedBridgeRequestIds.values().next().value as string | undefined;
            if (!oldest) break;
            abandonedBridgeRequestIds.delete(oldest);
        }
        abandonedBridgeRequestIds.add(requestId);
    };

    const post = (message: NativeMessage): boolean => {
        if (!disposed || message.type === 'teardown-complete' || message.type === 'protocol-error') {
            const parsed = nativeMessages.safeParse(message);
            if (!parsed.success) return false;
            const serialized = JSON.stringify(parsed.data);
            if (utf8ByteLength(serialized) > MCP_APP_MAX_BRIDGE_MESSAGE_BYTES) return false;
            native.postMessage(serialized);
            return true;
        }
        return false;
    };
    const emitResize = createResizeEmitter((height) => {
        if (instanceId) post({ type: 'resize', instanceId, height });
    }, shellWindow.requestAnimationFrame.bind(shellWindow));

    const release = async (acknowledge: boolean, graceful = true) => {
        const ownedId = instanceId;
        const ownedBridge = bridge;
        bridge = undefined;
        for (const pending of pendingBridgeRequests.values()) {
            pending.removeAbortListener();
            pending.reject(new McpError(ErrorCode.ConnectionClosed, 'App bridge closed.'));
        }
        pendingBridgeRequests.clear();
        abandonedBridgeRequestIds.clear();
        if (graceful && ownedBridge) {
            try {
                await Promise.race([
                    ownedBridge.teardownResource({}),
                    new Promise<void>((resolve) => shellWindow.setTimeout(resolve, 500)),
                ]);
            } catch {
                // The View may already be gone. Closing still revokes the transport.
            }
        }
        try {
            await ownedBridge?.close();
        } catch {
            // Best-effort close; iframe removal is the security boundary.
        }
        iframe?.remove();
        iframe = undefined;
        instanceId = undefined;
        if (acknowledge && ownedId) post({ type: 'teardown-complete', instanceId: ownedId });
    };

    const protocolFailure = () => {
        const ownedId = instanceId;
        void release(false, false).finally(() => {
            if (ownedId) post({ type: 'protocol-error', instanceId: ownedId });
        });
    };

    const relay = (request: McpAppBridgeRequest, signal?: AbortSignal): Promise<unknown> => {
        if (!instanceId || disposed || signal?.aborted) {
            return Promise.reject(new McpError(ErrorCode.ConnectionClosed, 'App bridge closed.'));
        }
        const parsed = mcpAppBridgeRequestSchema.safeParse(request);
        if (!parsed.success) {
            protocolFailure();
            return Promise.reject(new McpError(ErrorCode.InvalidParams, 'Invalid App request.'));
        }
        const requestId = `request-${++nextRequestId}`;
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                const pending = pendingBridgeRequests.get(requestId);
                if (!pending) return;
                pendingBridgeRequests.delete(requestId);
                pending.removeAbortListener();
                rememberAbandonedRequest(requestId);
                reject(new McpError(ErrorCode.ConnectionClosed, 'App bridge closed.'));
            };
            const removeAbortListener = () => signal?.removeEventListener('abort', onAbort);
            pendingBridgeRequests.set(requestId, { resolve, reject, removeAbortListener });
            signal?.addEventListener('abort', onAbort, { once: true });
            const sent = post({
                type: 'bridge-request',
                instanceId: instanceId!,
                requestId,
                request: parsed.data,
            });
            if (!sent) {
                pendingBridgeRequests.delete(requestId);
                removeAbortListener();
                protocolFailure();
                reject(new McpError(ErrorCode.InvalidRequest, 'Invalid App request.'));
            }
        });
    };

    const unsupported = async (): Promise<never> => {
        throw new McpError(ErrorCode.MethodNotFound, 'Method not found');
    };

    const handleCommand = async (raw: unknown) => {
        let command: HostCommand;
        try {
            command = parseHostCommand(raw as string);
        } catch {
            protocolFailure();
            return;
        }

        if (command.type === 'mount') {
            if (instanceId) {
                protocolFailure();
                return;
            }
            instanceId = command.instanceId;
            iframe = createSandboxedIframe(shellWindow.document, command.html);
            shellWindow.document.body.replaceChildren(iframe);
            const target = iframe.contentWindow;
            if (!target) {
                protocolFailure();
                return;
            }
            bridge = new PawsAppBridge(
                null,
                { name: 'Paws', version: '1.0.0' },
                { openLinks: {}, serverTools: {}, serverResources: {} },
                { hostContext: officialHostContext(command.context) },
            );
            bridge.onreadresource = async ({ uri }, extra) => relay({
                method: 'resources/read', params: { uri },
            }, extra.signal) as ReturnType<NonNullable<AppBridge['onreadresource']>>;
            bridge.oncalltool = async (params, extra) => relay({
                method: 'tools/call',
                params: {
                    name: params.name,
                    ...(params.arguments !== undefined ? { arguments: params.arguments } : {}),
                    ...(params._meta !== undefined ? { _meta: params._meta } : {}),
                },
            }, extra.signal) as ReturnType<NonNullable<AppBridge['oncalltool']>>;
            bridge.onopenlink = async ({ url }, extra) => relay({
                method: 'ui/open-link', params: { url },
            }, extra.signal) as ReturnType<NonNullable<AppBridge['onopenlink']>>;
            bridge.replacePingHandler(async (_request, extra) => relay({
                method: 'ping', params: {},
            }, extra.signal) as Promise<Record<string, never>>);
            bridge.onrequestdisplaymode = async ({ mode }) => {
                if (mode === 'inline') return { mode: 'inline' };
                return unsupported();
            };
            bridge.ondownloadfile = unsupported;
            bridge.onmessage = unsupported;
            bridge.onupdatemodelcontext = unsupported;
            bridge.oncreatesamplingmessage = unsupported;
            bridge.onlistresources = unsupported;
            bridge.onlistresourcetemplates = unsupported;
            bridge.onlistprompts = unsupported;
            bridge.oninitialized = () => {
                if (instanceId === command.instanceId) post({ type: 'initialized', instanceId: command.instanceId });
            };
            bridge.onsizechange = ({ height }) => {
                if (height !== undefined) emitResize(height);
            };
            bridge.onrequestteardown = () => { void release(true); };
            post({ type: 'sandbox-ready', instanceId: command.instanceId });
            try {
                await bridge.connect(new PostMessageTransport(target, target));
            } catch {
                protocolFailure();
            }
            return;
        }

        if (!instanceId || command.instanceId !== instanceId || !bridge) {
            protocolFailure();
            return;
        }
        try {
            switch (command.type) {
                case 'tool-input': await bridge.sendToolInput({ arguments: command.input }); break;
                case 'tool-result': await bridge.sendToolResult(
                    command.result as Parameters<AppBridge['sendToolResult']>[0],
                ); break;
                case 'tool-cancelled': await bridge.sendToolCancelled({ reason: command.reason }); break;
                case 'host-context': bridge.setHostContext(officialHostContext(command.context)); break;
                case 'bridge-response': {
                    const pending = pendingBridgeRequests.get(command.requestId);
                    if (!pending) {
                        if (abandonedBridgeRequestIds.delete(command.requestId)) break;
                        protocolFailure();
                        return;
                    }
                    pendingBridgeRequests.delete(command.requestId);
                    pending.removeAbortListener();
                    if (command.response.ok) {
                        pending.resolve(command.response.value);
                    } else {
                        pending.reject(new McpError(
                            ErrorCode.InternalError,
                            command.response.error.summary,
                            {
                                code: command.response.error.code,
                                retryable: command.response.error.retryable,
                            },
                        ));
                    }
                    break;
                }
                case 'teardown': await release(true); break;
            }
        } catch {
            protocolFailure();
        }
    };

    const listener = (event: MessageEvent) => {
        // The owned View shares window.message with native WebView delivery.
        // AppBridge exclusively owns messages from that exact inner window.
        if (iframe?.contentWindow && event.source === iframe.contentWindow) return;
        void handleCommand(event.data);
    };
    shellWindow.addEventListener('message', listener);
    shellWindow.document.addEventListener('message', listener as EventListener);
    return () => {
        disposed = true;
        shellWindow.removeEventListener('message', listener);
        shellWindow.document.removeEventListener('message', listener as EventListener);
        void release(false, false);
        shellConsole.debug = originalConsole.debug;
        shellConsole.info = originalConsole.info;
        shellConsole.log = originalConsole.log;
        shellConsole.warn = originalConsole.warn;
        shellConsole.error = originalConsole.error;
    };
}

if (typeof window !== 'undefined' && (window as ShellWindow).ReactNativeWebView) {
    startHostShell(window as ShellWindow);
}
