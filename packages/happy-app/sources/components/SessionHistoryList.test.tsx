import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer does not publish declarations.
import TestRenderer from 'react-test-renderer';
import { SessionHistoryList } from './SessionHistoryList';

const mocks = vi.hoisted(() => ({
    navigateToSession: vi.fn(),
    pathname: '/session/older',
    sessions: [
        { id: 'regular', updatedAt: Date.UTC(2026, 8, 5, 9), name: 'Regular session', metadata: { lifecycleState: 'running' } },
        { id: 'older', updatedAt: Date.UTC(2026, 8, 2, 9), name: 'Older session', metadata: { lifecycleState: 'archived' } },
        { id: 'newest', updatedAt: Date.UTC(2026, 8, 4, 9), name: 'Newest session', metadata: { lifecycleState: 'archiveRequested' } },
        { id: 'same-day', updatedAt: Date.UTC(2026, 8, 4, 8), name: 'Same-day session', metadata: { lifecycleState: 'archived' } },
    ] as any[],
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return {
        FlatList: ({ data, renderItem, ...props }: any) => ReactModule.createElement(
            'FlatList',
            props,
            data.map((item: any, index: number) => ReactModule.createElement(
                ReactModule.Fragment,
                { key: `${item.type}-${item.session?.id ?? item.date}-${index}` },
                renderItem({ item, index }),
            )),
        ),
        Pressable: ({ children, ...props }: any) => ReactModule.createElement(
            'Pressable',
            props,
            typeof children === 'function' ? children({ pressed: false }) : children,
        ),
        View: 'View',
    };
});
vi.mock('expo-router', () => ({ usePathname: () => mocks.pathname }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        hairlineWidth: 1,
        create: (factory: any) => factory({ colors: {
            divider: '#333', groupped: { background: '#111', sectionTitle: '#aaa' },
            surface: '#171717', surfacePressed: '#222', surfaceSelected: '#292929',
            text: '#fff', textSecondary: '#aaa',
        } }),
    },
}));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('@/components/Avatar', () => ({ Avatar: 'Avatar' }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/sync/storage', () => ({ useAllSessions: () => mocks.sessions }));
vi.mock('@/hooks/useNavigateToSession', () => ({ useNavigateToSession: () => mocks.navigateToSession }));
vi.mock('@/utils/sessionUtils', () => ({
    getSessionAvatarId: (session: any) => `avatar-${session.id}`,
    getSessionName: (session: any) => session.name,
    getSessionSubtitle: (session: any) => `subtitle-${session.id}`,
}));
vi.mock('@/text', () => ({
    t: (key: string, params?: { count?: number }) => params?.count == null ? key : `${key}:${params.count}`,
}));
vi.mock('@/components/EmptySessionsTablet', () => ({
    EmptySessionsTablet: 'EmptySessionsTablet',
    shouldShowSessionEmptyState: (count: number) => count === 0,
}));

describe('SessionHistoryList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 8, 4, 12));
        mocks.pathname = '/session/older';
        mocks.sessions = [
            { id: 'regular', updatedAt: Date.UTC(2026, 8, 5, 9), name: 'Regular session', metadata: { lifecycleState: 'running' } },
            { id: 'older', updatedAt: Date.UTC(2026, 8, 2, 9), name: 'Older session', metadata: { lifecycleState: 'archived' } },
            { id: 'newest', updatedAt: Date.UTC(2026, 8, 4, 9), name: 'Newest session', metadata: { lifecycleState: 'archiveRequested' } },
            { id: 'same-day', updatedAt: Date.UTC(2026, 8, 4, 8), name: 'Same-day session', metadata: { lifecycleState: 'archived' } },
        ];
    });

    it('shows only archived conversations, newest first, and opens them in the existing session route', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<SessionHistoryList variant="sidebar" />); });

        const rows = renderer.root.findAll((node: any) => node.props.testID?.startsWith('session-history-row-'));
        const uniqueRows = rows.filter((node: any) => node.type === 'Pressable');
        expect(uniqueRows.map((node: any) => node.props.testID)).toEqual([
            'session-history-row-newest',
            'session-history-row-same-day',
            'session-history-row-older',
        ]);
        expect(renderer.root.findAllByProps({ testID: 'session-history-row-regular' })).toHaveLength(0);
        expect(renderer.root.findByProps({ testID: 'session-history-row-older' }).props.accessibilityState).toEqual({ selected: true });

        act(() => renderer.root.findByProps({ testID: 'session-history-row-newest' }).props.onPress());
        expect(mocks.navigateToSession).toHaveBeenCalledWith('newest');

        act(() => renderer.unmount());
        vi.useRealTimers();
    });

    it('shows archive-specific empty guidance when no archived conversations exist', () => {
        mocks.sessions = [{
            id: 'regular',
            updatedAt: Date.UTC(2026, 8, 5, 9),
            name: 'Regular session',
            metadata: { lifecycleState: 'running' },
        }];
        let renderer: any;

        act(() => { renderer = TestRenderer.create(<SessionHistoryList variant="sidebar" />); });

        expect(renderer.root.findByType('EmptySessionsTablet').props).toMatchObject({
            description: 'sessionHistory.archiveEmptyDescription',
            icon: 'archive-outline',
            showNewSessionAction: false,
            title: 'sessionHistory.archiveEmpty',
        });

        act(() => renderer.unmount());
        vi.useRealTimers();
    });
});
