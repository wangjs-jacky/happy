import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
const mocks = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn(), revoke: vi.fn(), token: 'owner' }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'native' }, useWindowDimensions: () => ({ width: 1200 }),
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } }));
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: () => ({}) }, useUnistyles: () => ({ theme: { colors: {} } }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('expo-router', () => ({ usePathname: () => '/apps/conversations', useRouter: () => ({ navigate: mocks.navigate }) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ credentials: { token: mocks.token } }) }));
vi.mock('@/sync/storage', () => ({ useAllMachines: () => [{ id: 'old-device', metadata: { displayName: 'Old device' } }, { id: 'binding-device', metadata: { displayName: 'Binding device' } }] }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://paws.test' }));
vi.mock('@/sync/apiAppDelegation', async importOriginal => ({ ...await importOriginal<object>(), appAuthorizationRequest: mocks.request }));
vi.mock('@/sync/apiAIServices', () => ({ createAIServicesAPI: () => ({ revoke: mocks.revoke }) }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/modal', () => ({ Modal: { confirm: async () => true } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('./AppConnectionsMenu', () => ({ AppConnectionsMenu: (props: any) => React.createElement('ConnectionsMenu', props) }));
import { AppConversationsSidebar } from './AppConversationsSidebar';
const grant = { id: 'service-grant', appId: 'relationship-advisor', machineId: 'old-device', state: 'redeemed',
    expiresAt: null, createdAt: '2026-10-07T00:00:00Z', protocol: 'ai-services/1' };
const serviceConversation = { id: 'service-conversation', grantId: grant.id, protocol: 'ai-services/1', machineId: 'binding-device',
    createdAt: grant.createdAt, lastActivityAt: grant.createdAt, turns: [{ state: 'accepted', createdAt: grant.createdAt }] };
let renderer: any;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mocks.token = 'owner';
    mocks.request.mockReset().mockImplementation(async (_token, path) => path.startsWith('/conversations')
        ? { conversations: [serviceConversation], nextCursor: null } : { grants: [grant] });
    mocks.revoke.mockReset().mockResolvedValue({ revoked: true }); mocks.navigate.mockReset();
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); renderer = null; delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; });
it('opts into merged history, labels the immutable target device and opens the new conversation', async () => {
    await act(async () => { renderer = TestRenderer.create(<AppConversationsSidebar />); });
    expect(mocks.request.mock.calls.map(call => call[1])).toEqual(['?includeServices=1', '/conversations?includeServices=1']);
    const row = renderer.root.findByProps({ testID: 'app-conversation-service-conversation' });
    expect(row.findAllByType('Text').map((node: any) => node.props.children)).toContain('Binding device');
    expect(row.findAllByType('Text').map((node: any) => node.props.children)).toContain('appConversations.queued');
    act(() => row.props.onPress());
    expect(mocks.navigate).toHaveBeenCalledWith('/apps/conversations/service-conversation');
});
it('revokes service grants through their service authorization route', async () => {
    await act(async () => { renderer = TestRenderer.create(<AppConversationsSidebar />); });
    act(() => renderer.root.findByProps({ testID: 'app-conversations-menu-relationship-advisor' }).props.onPress());
    await act(async () => { renderer.root.findByType('ConnectionsMenu').props.onChangeGrant(grant, false); });
    expect(mocks.revoke).toHaveBeenCalledWith(grant.id);
    expect(mocks.request.mock.calls.filter(call => call[3] === 'DELETE')).toHaveLength(0);
});
