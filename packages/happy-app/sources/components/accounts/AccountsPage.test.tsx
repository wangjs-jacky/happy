import React, { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace
import TestRenderer from 'react-test-renderer';
const mocks = vi.hoisted(() => ({
    params: {} as { accountKey?: string }, list: vi.fn(), remove: vi.fn(), confirm: vi.fn(),
    push: vi.fn(), back: vi.fn(), replace: vi.fn(), hasList: true, focus: undefined as undefined | (() => (() => void)),
}));
vi.mock('react-native', () => ({ Text: 'Text', TextInput: 'TextInput', View: 'View' }));
vi.mock('expo-router', () => ({
    router: { push: mocks.push, back: mocks.back, replace: mocks.replace },
    useNavigation: () => ({ getState: () => ({ index: mocks.hasList ? 1 : 0, routes: mocks.hasList ? [{ name: 'accounts' }, { name: 'accounts', params: { accountKey: 'b' } }] : [{ name: 'accounts', params: { accountKey: 'b' } }] }) }),
    useLocalSearchParams: () => mocks.params,
    useFocusEffect: (callback: () => (() => void)) => { mocks.focus = callback; useEffect(callback, [callback]); },
}));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({}) }));
vi.mock('@/auth/accounts', () => ({ listSavedAccounts: mocks.list, removeSavedAccount: mocks.remove }));
vi.mock('@/auth/accountRuntime', () => ({ getActiveAccountKey: () => 'a', canonicalAccountServer: (url: string) => url }));
vi.mock('@/auth/accountLink', () => ({ parseAccountSessionTarget: () => null }));
vi.mock('@/auth/tokenStorage', () => ({ AccountVault: { read: async () => null } }));
vi.mock('@/auth/secretKeyBackup', () => ({ formatSecretKeyForBackup: (s: string) => s }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://example.test' }));
vi.mock('@/components/Item', () => ({ Item: 'Item' }));
vi.mock('@/components/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ItemList', () => ({ ItemList: 'ItemList' }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@/modal', () => ({ Modal: { confirm: mocks.confirm } }));
vi.mock('@/text', () => ({ t: (s: string) => s }));
vi.mock('react-native-unistyles', () => {
    const theme = { colors: {} };
    return { StyleSheet: { create: (fn: any) => fn(theme) }, useUnistyles: () => ({ theme }) };
});
vi.mock('react-native-reanimated', () => {
    const transition = { duration: () => ({ reduceMotion: () => ({}) }) };
    return { default: { View: 'AnimatedView' }, FadeIn: transition, FadeOut: transition, LinearTransition: transition, ReduceMotion: { System: 'system' } };
});
import AccountsPage from '@/app/(app)/accounts';
const accounts = [
    { key: 'a', accountId: 'A', label: 'Current', serverUrl: 'https://example.test' },
    { key: 'b', accountId: 'B', label: 'Secondary', serverUrl: 'https://example.test' },
];
let renderer: any;
const rows = (title: string) => renderer.root.findAllByType('Item').filter((node: any) => node.props.title === title);
const mount = async (key?: string) => {
    mocks.params = key ? { accountKey: key } : {};
    await act(async () => { renderer = TestRenderer.create(<AccountsPage />); });
};
beforeEach(() => {
    vi.clearAllMocks(); mocks.hasList = true; mocks.list.mockResolvedValue(accounts); mocks.confirm.mockResolvedValue(true); mocks.remove.mockResolvedValue(undefined);
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
describe('account removal from details', () => {
    it('keeps the list navigable without removal controls and refreshes on return', async () => {
        await mount();
        expect(rows('accounts.remove')).toHaveLength(0);
        act(() => rows('Secondary')[0].props.onPress());
        expect(mocks.push).toHaveBeenCalledWith({ pathname: '/accounts', params: { accountKey: 'b' } });
        mocks.list.mockResolvedValue([accounts[0]]);
        await act(async () => { mocks.focus!(); });
        expect(rows('Secondary')).toHaveLength(0);
    });
    it('hides removal for the active account', async () => {
        await mount('a');
        expect(rows('accounts.remove')).toHaveLength(0);
    });
    it('confirms the named account and returns to the list after removal', async () => {
        await mount('b');
        expect(rows('accounts.remove')[0].props).toMatchObject({ destructive: true, showChevron: false });
        await act(async () => rows('accounts.remove')[0].props.onPress());
        expect(mocks.confirm).toHaveBeenCalledWith('accounts.remove', 'Secondary\n\naccounts.removeHint', { destructive: true, confirmText: 'accounts.remove' });
        expect(mocks.remove).toHaveBeenCalledExactlyOnceWith('b');
        expect(mocks.back).toHaveBeenCalledOnce();
    });
    it('opens a fresh list when details were opened directly', async () => {
        mocks.hasList = false;
        await mount('b');
        await act(async () => rows('accounts.remove')[0].props.onPress());
        expect(mocks.back).not.toHaveBeenCalled();
        expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/accounts');
    });
    it('leaves the account intact when confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValue(false);
        await mount('b');
        await act(async () => rows('accounts.remove')[0].props.onPress());
        expect(mocks.remove).not.toHaveBeenCalled();
        expect(mocks.back).not.toHaveBeenCalled();
    });
    it('stays on details and allows retry after a removal failure', async () => {
        mocks.remove.mockRejectedValueOnce(new Error('storage unavailable'));
        await mount('b');
        await act(async () => rows('accounts.remove')[0].props.onPress());
        expect(mocks.back).not.toHaveBeenCalled();
        expect(renderer.root.findAllByType('ItemGroup').some((node: any) => node.props.footer === 'accounts.failed')).toBe(true);
        expect(rows('accounts.remove')[0].props.disabled).toBe(false);
        await act(async () => rows('accounts.remove')[0].props.onPress());
        expect(mocks.back).toHaveBeenCalledOnce();
    });
});
