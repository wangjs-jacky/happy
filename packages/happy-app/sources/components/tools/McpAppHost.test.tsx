import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { McpAppHost } from './McpAppHost';
import { McpAppHostError, type McpAppFrame, type McpAppFrameAdapter, type McpAppRemotePort } from './mcpApps/types';

const mocks = vi.hoisted(() => ({
    presence: 'online' as string | number,
    reads: [] as unknown[],
    readError: null as McpAppHostError | null,
    frameMountInput: null as any,
}));

vi.mock('react-native', () => ({
    Platform: { OS: 'android' },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));
vi.mock('react-native-unistyles', () => {
    const theme: Record<string, any> = { dark: true, colors: { surface: '#111', surfacePressed: '#222', text: '#fff', textSecondary: '#aaa', warning: '#f90' } };
    return {
        StyleSheet: { create: (factory: unknown) => typeof factory === 'function' ? (factory as (value: typeof theme) => object)(theme) : factory },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/sync/storage', () => ({ useSession: () => ({ presence: mocks.presence }) }));
vi.mock('@/modal', () => ({ Modal: { confirm: vi.fn(async () => false) } }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock('@/text', () => ({
    getCurrentLanguage: () => 'en',
    t: (key: string) => key,
}));
vi.mock('./mcpApps/remotePort', () => ({
    createMcpAppRemotePort: (): McpAppRemotePort => ({
        readResource: async (input: unknown) => {
            mocks.reads.push(input);
            if (mocks.readError) throw mocks.readError;
            return {
                resourceId: 'resource-1', uri: 'ui://demo/index.html', mimeType: 'text/html;profile=mcp-app',
                byteLength: 17, sha256: 'a'.repeat(64), encoding: 'utf8', html: '<main>safe</main>',
            };
        },
        readSecondaryResource: async () => ({ contents: [] }),
        callTool: async () => { throw new Error('not supported'); },
    }),
}));
vi.mock('./mcpApps/NativeMcpAppFrameAdapter', () => {
    class Frame implements McpAppFrame {
        sendToolInput() {}
        sendToolResult() {}
        sendToolCancelled() {}
        updateHostContext() {}
        async teardown() {}
    }
    class Adapter implements McpAppFrameAdapter {
        async mount(input: any) {
            mocks.frameMountInput = input;
            input.onSandboxReady();
            return new Frame();
        }
    }
    return {
        createMcpAppFrameAdapter: () => new Adapter(),
        McpAppFrameView: () => React.createElement('Frame'),
    };
});

const toolCall = {
    callId: 'wire-call-1',
    name: 'mcp__demo__show',
    state: 'running' as const,
    input: { city: 'Hangzhou' },
    createdAt: 1,
    startedAt: 1,
    completedAt: null,
    description: 'Show demo',
};
const presentation = {
    version: 1 as const,
    server: 'sensitive-server',
    resourceUri: 'ui://demo/index.html',
};

describe('McpAppHost state presentation', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.presence = 'online';
        mocks.reads.length = 0;
        mocks.readError = null;
        mocks.frameMountInput = null;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('uses the immutable wire call ID for loading and renders the sandbox when active', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<McpAppHost sessionId="session-1" toolCall={toolCall} presentation={presentation} />);
        });

        expect(mocks.reads).toHaveLength(1);
        expect(mocks.reads[0]).toMatchObject({ callId: 'wire-call-1' });
        expect(renderer.root.findByType('Frame')).toBeTruthy();
        expect(renderer.root.findAllByProps({ testID: 'mcp-app-error' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('shows translated offline state without opening the resource', async () => {
        mocks.presence = 123;
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<McpAppHost sessionId="session-1" toolCall={toolCall} presentation={presentation} />);
        });

        const fallback = renderer.root.findByProps({ testID: 'mcp-app-error' });
        expect(fallback.findByType('Text').props.children).toBe('mcpApps.offline');
        expect(mocks.reads).toEqual([]);
        act(() => renderer.unmount());
    });

    it('keeps unavailable results static and maps unsupported failures to display-safe copy', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <McpAppHost
                    sessionId="session-1"
                    toolCall={toolCall}
                    presentation={presentation}
                    result={{ version: 1, state: 'unavailable', code: 'MCP_APP_RESULT_TOO_LARGE' }}
                />,
            );
        });
        expect(renderer.root.findByProps({ testID: 'mcp-app-error' }).findByType('Text').props.children).toBe('mcpApps.unavailable');
        expect(mocks.reads).toEqual([]);
        act(() => renderer.unmount());

        mocks.readError = new McpAppHostError('MCP_APP_UNSUPPORTED', false, 'sensitive connector detail');
        await act(async () => {
            renderer = TestRenderer.create(<McpAppHost sessionId="session-1" toolCall={toolCall} presentation={presentation} />);
        });
        const unsupported = renderer.root.findByProps({ testID: 'mcp-app-error' });
        expect(unsupported.findByType('Text').props.children).toBe('mcpApps.unsupported');
        expect(JSON.stringify(renderer.toJSON())).not.toContain('sensitive connector detail');
        act(() => renderer.unmount());
    });

    it('offers one translated retry for retryable safe failures', async () => {
        mocks.readError = new McpAppHostError('MCP_APP_INTERNAL', true, 'sensitive connector detail');
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<McpAppHost sessionId="session-1" toolCall={toolCall} presentation={presentation} />);
        });

        expect(renderer.root.findByProps({ testID: 'mcp-app-error' }).findAllByType('Text')[0].props.children).toBe('mcpApps.unavailable');
        expect(renderer.root.findByProps({ testID: 'mcp-app-retry' }).findByType('Text').props.children).toBe('mcpApps.retry');
        act(() => renderer.unmount());
    });

    it('replaces an active frame with a safe visible error after a post-mount failure', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <McpAppHost sessionId="session-1" toolCall={toolCall} presentation={presentation} />,
            );
        });
        expect(renderer.root.findByType('Frame')).toBeTruthy();
        expect(mocks.frameMountInput?.onFailure).toEqual(expect.any(Function));

        await act(async () => {
            mocks.frameMountInput.onFailure(new McpAppHostError(
                'MCP_APP_BRIDGE_PROTOCOL', false, 'sensitive protocol detail',
            ));
        });

        const fallback = renderer.root.findByProps({ testID: 'mcp-app-error' });
        expect(fallback.findByType('Text').props.children).toBe('mcpApps.unavailable');
        expect(renderer.root.findAllByType('Frame')).toHaveLength(0);
        expect(renderer.root.findAllByProps({ testID: 'mcp-app-retry' })).toHaveLength(0);
        expect(JSON.stringify(renderer.toJSON())).not.toContain('sensitive protocol detail');
        act(() => renderer.unmount());
    });

    it('offers retry after a retryable post-active WebView termination', async () => {
        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(
                <McpAppHost sessionId="session-1" toolCall={toolCall} presentation={presentation} />,
            );
        });

        await act(async () => {
            mocks.frameMountInput.onFailure(new McpAppHostError(
                'MCP_APP_SANDBOX_UNAVAILABLE', true, 'sensitive process detail',
            ));
        });

        expect(renderer.root.findByProps({ testID: 'mcp-app-error' })).toBeTruthy();
        expect(renderer.root.findByProps({ testID: 'mcp-app-retry' }).findByType('Text').props.children)
            .toBe('mcpApps.retry');
        expect(renderer.root.findAllByType('Frame')).toHaveLength(0);
        expect(JSON.stringify(renderer.toJSON())).not.toContain('sensitive process detail');
        act(() => renderer.unmount());
    });
});
