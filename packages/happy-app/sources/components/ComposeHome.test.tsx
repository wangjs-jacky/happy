import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposeHome } from './ComposeHome';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
    retryHydration: vi.fn(),
    hydrationError: null as { sessionId: string } | null,
    setHydrationError: null as React.Dispatch<React.SetStateAction<{ sessionId: string } | null>> | null,
    clearImages: vi.fn(),
    setPendingReferences: vi.fn(),
    draft: {
        agentType: 'codex',
        selectedMachineId: 'machine-1',
        selectedPath: '/Users/test/project',
        worktreeKey: null,
        permissionMode: 'default',
        modelMode: 'default',
        effortLevel: null,
        setAgentType: vi.fn(),
    },
}));

vi.mock('react-native', () => ({
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    LayoutAnimation: { configureNext: vi.fn(), Presets: { easeInEaseOut: {} } },
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
    useWindowDimensions: () => ({ width: 480, height: 800 }),
}));
vi.mock('react-native-unistyles', () => {
    const colors = {
        accent: '#58a',
        divider: '#333',
        surface: '#222',
        surfacePressed: '#333',
        text: '#fff',
        textSecondary: '#aaa',
        textDestructive: '#f66',
        groupped: { background: '#111' },
        header: { tint: '#fff' },
        input: { background: '#222' },
        status: { connected: '#0f0', disconnected: '#f00', error: '#f00' },
        button: { primary: { background: '#58a', tint: '#fff' } },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: unknown) => typeof factory === 'function'
                ? (factory as (theme: { colors: typeof colors; dark: boolean }) => object)({ colors, dark: true })
                : factory,
        },
        useUnistyles: () => ({ theme: { colors, dark: true } }),
    };
});
vi.mock('expo-router', () => ({
    useRouter: () => ({ canGoBack: () => false, back: vi.fn(), replace: vi.fn(), push: vi.fn() }),
    useNavigation: () => ({ dispatch: vi.fn() }),
    useLocalSearchParams: () => ({}),
}));
vi.mock('@react-navigation/native', () => ({ DrawerActions: { openDrawer: vi.fn() } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: 'KeyboardAvoidingView' }));
vi.mock('@/utils/responsive', () => ({ useHeaderHeight: () => 44, useIsTablet: () => false }));
vi.mock('@/utils/isTauri', () => ({ isTauri: () => false }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), display: () => ({}), mono: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/hooks/useSpawnSession', async () => {
    const ReactModule = await import('react');
    return {
        useSpawnSession: () => {
            const [hydrationError, setHydrationError] = ReactModule.useState(mocks.hydrationError);
            mocks.setHydrationError = setHydrationError;
            return {
                sending: false,
                spawn: mocks.spawn,
                retryHydration: mocks.retryHydration,
                hydrationError,
            };
        },
    };
});
vi.mock('@/hooks/useNewSessionDraft', () => ({
    useNewSessionDraft: Object.assign(
        (selector: (state: typeof mocks.draft) => unknown) => selector(mocks.draft),
        { getState: () => mocks.draft },
    ),
}));
vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }));
vi.mock('@/hooks/useImagePicker', () => ({
    useImagePicker: () => ({
        selectedImages: [],
        pickImages: vi.fn(),
        pickAttachment: vi.fn(),
        removeImage: vi.fn(),
        clearImages: mocks.clearImages,
        addImages: vi.fn(),
    }),
}));
vi.mock('@/sync/storage', () => {
    const storage = Object.assign(
        (selector: (state: unknown) => unknown) => selector({ sessions: {}, sessionMessages: {} }),
        { getState: () => ({ sessions: {}, sessionMessages: {} }) },
    );
    const machine = {
        id: 'machine-1', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
        metadata: { host: 'mac', homeDir: '/Users/test' }, metadataVersion: 1,
        daemonState: null, daemonStateVersion: 1,
    };
    return {
        storage,
        useProfile: () => ({ id: 'profile-1', firstName: 'Test' }),
        useAllMachines: () => [machine],
        useLocalSetting: (key: string) => key === 'agents' ? [] : null,
        useLocalSettingMutable: () => [false, vi.fn()],
        useSetting: () => ({}),
        useSettingMutable: (key: string) => key === 'pendingCustomImageStyleReferences'
            ? [[], mocks.setPendingReferences]
            : [[], vi.fn()],
    };
});
vi.mock('@/hooks/useDesktopWorkspaceLayout', () => ({
    useDesktopWorkspaceLayout: () => ({
        leftVisible: false,
        leftWidth: 0,
        rightPanelAvailable: false,
        rightExpandedWidth: 0,
        rightWidth: 0,
    }),
}));
vi.mock('./DesktopSettingsModal', () => ({ useDesktopSettingsModal: () => ({ openSettings: vi.fn() }) }));
vi.mock('@/hooks/useGeneratedImagesPlugin', () => ({ useGeneratedImagesPlugin: () => ({ status: { installed: false } }) }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() } }));
vi.mock('@/sync/ops', () => ({ machineSpawnNewSession: vi.fn(), sessionArchive: vi.fn() }));
vi.mock('@/sync/sync', () => ({ sync: { refreshSessions: vi.fn(), sendMessage: vi.fn() } }));
vi.mock('@/utils/normalizeImageForUpload', () => ({ normalizeImageForUpload: vi.fn() }));
vi.mock('./haptics', () => ({ hapticsLight: vi.fn() }));
vi.mock('./navigation/Header', () => ({ Header: 'Header' }));
vi.mock('./layout', () => ({ layout: { maxWidth: 720, headerMaxWidth: 720 } }));
vi.mock('./MessageComposer', () => ({ MessageComposer: 'MessageComposer' }));
vi.mock('./SessionConfigPanel', () => ({ SessionConfigPanel: 'SessionConfigPanel' }));
vi.mock('./ComposeHomeParticles', () => ({ ComposeHomeParticles: 'ComposeHomeParticles' }));
vi.mock('./Avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('./RightSwipePanelHost', () => ({ RightSwipePanelHost: 'RightSwipePanelHost', useRightSwipePanel: () => null }));
vi.mock('./rightPanel/SessionCapabilityHub', () => ({ SessionCapabilityHub: 'SessionCapabilityHub' }));
vi.mock('./DesktopRightPanel', () => ({ DesktopRightPanel: 'DesktopRightPanel', DesktopRightPanelToggleButton: 'DesktopRightPanelToggleButton' }));
vi.mock('./agents/ImageStyleGallerySheet', () => ({ ImageStyleGallerySheet: 'ImageStyleGallerySheet' }));
vi.mock('./agents/builtinAgents', () => ({ createAppBuilderAgent: () => null }));

describe('ComposeHome session hydration recovery', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.hydrationError = null;
        mocks.setHydrationError = null;
        mocks.spawn.mockImplementation(async () => {
            mocks.setHydrationError?.({ sessionId: 'session-1' });
            return false;
        });
        mocks.retryHydration.mockImplementation(async () => {
            mocks.setHydrationError?.(null);
            return true;
        });
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('preserves the draft after hydration failure and clears it only after retry succeeds', async () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(<ComposeHome variant="screen" />);
        });

        act(() => {
            renderer.root.findByType('MessageComposer').props.onChangeText('Keep this draft');
        });
        await act(async () => {
            renderer.root.findByType('MessageComposer').props.onSend();
            await Promise.resolve();
        });

        expect(renderer.root.findByType('MessageComposer').props.initialValue).toBe('Keep this draft');
        expect(mocks.spawn).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Keep this draft' }));
        expect(mocks.clearImages).not.toHaveBeenCalled();

        const notice = renderer.root.findByProps({ testID: 'compose-home-session-hydration-error' });
        expect(notice.findAllByType('Text')[0].props.children).toBe('newSession.sessionHydrationFailed');

        await act(async () => {
            await renderer.root.findByProps({ testID: 'compose-home-session-hydration-retry' }).props.onPress();
        });

        expect(mocks.retryHydration).toHaveBeenCalledTimes(1);
        expect(renderer.root.findByType('MessageComposer').props.initialValue).toBe('');
        expect(mocks.clearImages).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });
});
