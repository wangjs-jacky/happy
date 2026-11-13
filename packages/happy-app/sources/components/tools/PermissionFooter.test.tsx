import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { PermissionFooter } from './PermissionFooter';

const mocks = vi.hoisted(() => ({
    allow: vi.fn(),
    deny: vi.fn(),
    presence: 123 as 'online' | number,
}));

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Platform: { OS: 'web' },
    StyleSheet: { create: (styles: object) => styles },
    Text: 'Text',
    TouchableOpacity: 'TouchableOpacity',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/sync/ops', () => ({ sessionAllow: mocks.allow, sessionDeny: mocks.deny }));
vi.mock('@/sync/storage', () => ({
    storage: { getState: () => ({ updateSessionPermissionMode: vi.fn() }) },
    useSession: () => ({ presence: mocks.presence }),
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: {
                divider: '#ddd',
                input: { background: '#fff' },
                surfacePressed: '#eee',
                text: '#111',
                textSecondary: '#666',
            },
        },
    }),
}));

function renderCodexFooter() {
    return TestRenderer.create(
        <PermissionFooter
            metadata={{ flavor: 'codex' }}
            permission={{ id: 'permission-1', status: 'pending' }}
            sessionId="session-1"
            toolName="CodexBash"
        />,
    );
}

describe('PermissionFooter offline protection', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.presence = 123;
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('keeps the pending confirmation visible but disables every Codex response while disconnected', async () => {
        let renderer: any;
        act(() => { renderer = renderCodexFooter(); });

        expect(renderer.root.findByProps({ testID: 'permission-offline-notice' })).toBeTruthy();
        for (const testID of [
            'permission-approve-button',
            'permission-approve-session-button',
            'permission-abort-button',
        ]) {
            const button = renderer.root.findByProps({ testID });
            expect(button.props.disabled).toBe(true);
            await act(async () => { await button.props.onPress(); });
        }
        expect(mocks.allow).not.toHaveBeenCalled();
        expect(mocks.deny).not.toHaveBeenCalled();

        act(() => renderer.unmount());
    });

    it('enables responses again once the session reconnects', () => {
        mocks.presence = 'online';
        let renderer: any;
        act(() => { renderer = renderCodexFooter(); });

        expect(renderer.root.findAllByProps({ testID: 'permission-offline-notice' })).toHaveLength(0);
        expect(renderer.root.findByProps({ testID: 'permission-approve-button' }).props.disabled).toBe(false);
        expect(renderer.root.findByProps({ testID: 'permission-approve-session-button' }).props.disabled).toBe(false);
        expect(renderer.root.findByProps({ testID: 'permission-abort-button' }).props.disabled).toBe(false);

        act(() => renderer.unmount());
    });

    it('only offers the supported one-time allow and deny actions for Personal', async () => {
        mocks.presence = 'online';
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<PermissionFooter metadata={{ flavor: 'personal' }}
            permission={{ id: 'personal-permission', status: 'pending' }} sessionId="personal-session" toolName="run_command" />); });
        expect(renderer.root.findAllByProps({ testID: 'permission-approve-session-button' })).toHaveLength(0);
        expect(renderer.root.findAllByProps({ testID: 'permission-approve-edits-button' })).toHaveLength(0);
        await act(async () => { await renderer.root.findByProps({ testID: 'permission-approve-button' }).props.onPress(); });
        expect(mocks.allow).toHaveBeenCalledWith('personal-session', 'personal-permission');
        act(() => renderer.unmount());
    });

    it('shows a failed Personal decision and allows a one-time retry', async () => {
        mocks.presence = 'online';
        mocks.allow.mockRejectedValueOnce(new Error('RPC unavailable')).mockResolvedValueOnce(undefined);
        consoleErrorSpy.mockImplementation(() => {});
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<PermissionFooter metadata={{ flavor: 'personal' }}
            permission={{ id: 'personal-permission', status: 'pending' }} sessionId="personal-session" toolName="run_command" />); });
        await act(async () => { await renderer.root.findByProps({ testID: 'permission-approve-button' }).props.onPress(); });
        expect(renderer.root.findByProps({ accessibilityRole: 'alert' }).children).toContain('personalAgent.approvalFailed');
        expect(renderer.root.findByProps({ testID: 'permission-approve-button' }).props.disabled).toBe(false);
        await act(async () => { await renderer.root.findByProps({ testID: 'permission-approve-button' }).props.onPress(); });
        expect(mocks.allow).toHaveBeenCalledTimes(2);
        expect(renderer.root.findAllByProps({ accessibilityRole: 'alert' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('keeps Personal decisions disabled offline and sends the original request id when denied', async () => {
        let renderer: any;
        const footer = () => <PermissionFooter metadata={{ flavor: 'personal' }}
            permission={{ id: 'personal-permission', status: 'pending' }} sessionId="personal-session" toolName="run_command" />;
        act(() => { renderer = TestRenderer.create(footer()); });
        expect(renderer.root.findByProps({ testID: 'permission-offline-notice' })).toBeTruthy();
        for (const testID of ['permission-approve-button', 'permission-deny-button']) {
            expect(renderer.root.findByProps({ testID }).props.disabled).toBe(true);
            await act(async () => { await renderer.root.findByProps({ testID }).props.onPress(); });
        }
        expect(mocks.allow).not.toHaveBeenCalled();
        expect(mocks.deny).not.toHaveBeenCalled();
        mocks.presence = 'online';
        act(() => { renderer.update(footer()); });
        await act(async () => { await renderer.root.findByProps({ testID: 'permission-deny-button' }).props.onPress(); });
        expect(mocks.deny).toHaveBeenCalledWith('personal-session', 'personal-permission');
        act(() => renderer.unmount());
    });
});
