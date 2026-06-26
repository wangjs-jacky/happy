import type { Router } from "expo-router"
import { useRouter, useNavigation } from "expo-router"
import { DrawerActions } from '@react-navigation/native';
import { storage } from '@/sync/storage';
import { trackSessionSwitched } from '@/track';

export function navigateToSession(router: Router, sessionId: string) {
    const session = storage.getState().sessions[sessionId];
    if (session) {
        trackSessionSwitched(session);
    }

    router.push(`/session/${encodeURIComponent(sessionId)}`);
}

export function useNavigateToSession() {
    const router = useRouter();
    const navigation = useNavigation();
    return (sessionId: string) => {
        // On phone the sidebar is a `front` drawer overlay that would otherwise
        // stay open on top of the pushed session screen, so close it first.
        // On desktop the drawer is permanent and closeDrawer is a harmless no-op.
        navigation.dispatch(DrawerActions.closeDrawer());
        navigateToSession(router, sessionId);
    }
}
