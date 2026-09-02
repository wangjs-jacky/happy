import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import { z } from 'zod';
import {
    MCP_APP_MAX_FRAME_HEIGHT,
    MCP_APP_MIN_FRAME_HEIGHT,
    hostContextSchema,
    parseHostCommand,
    type HostCommand,
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

/** Starts the browser-only shell. The inner opaque-origin View never receives the native bridge object. */
export function startHostShell(shellWindow: ShellWindow = window as ShellWindow): () => void {
    const native = shellWindow.ReactNativeWebView;
    if (!native) return () => {};

    let instanceId: string | undefined;
    let iframe: HTMLIFrameElement | undefined;
    let bridge: AppBridge | undefined;
    let disposed = false;

    const post = (message: NativeMessage) => {
        if (!disposed || message.type === 'teardown-complete' || message.type === 'protocol-error') {
            native.postMessage(JSON.stringify(message));
        }
    };
    const emitResize = createResizeEmitter((height) => {
        if (instanceId) post({ type: 'resize', instanceId, height });
    }, shellWindow.requestAnimationFrame.bind(shellWindow));

    const release = async (acknowledge: boolean, graceful = true) => {
        const ownedId = instanceId;
        const ownedBridge = bridge;
        bridge = undefined;
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
            bridge = new AppBridge(
                null,
                { name: 'Paws', version: '1.0.0' },
                {},
                { hostContext: officialHostContext(command.context) },
            );
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
                case 'teardown': await release(true); break;
            }
        } catch {
            protocolFailure();
        }
    };

    const listener = (event: MessageEvent) => { void handleCommand(event.data); };
    shellWindow.addEventListener('message', listener);
    shellWindow.document.addEventListener('message', listener as EventListener);
    return () => {
        disposed = true;
        shellWindow.removeEventListener('message', listener);
        shellWindow.document.removeEventListener('message', listener as EventListener);
        void release(false, false);
    };
}

if (typeof window !== 'undefined' && (window as ShellWindow).ReactNativeWebView) {
    startHostShell(window as ShellWindow);
}
