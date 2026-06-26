import type { Router } from "expo-router"
import { useRouter } from "expo-router"
import { storage } from '@/sync/storage';
import { trackSessionSwitched } from '@/track';
import { closeSidebarDrawer } from '@/components/sidebarDrawerControl';

export function navigateToSession(router: Router, sessionId: string) {
    const session = storage.getState().sessions[sessionId];
    if (session) {
        trackSessionSwitched(session);
    }

    router.push(`/session/${encodeURIComponent(sessionId)}`);
}

export function useNavigateToSession() {
    const router = useRouter();
    return (sessionId: string) => {
        // Close the phone sidebar drawer before navigating. A local
        // useNavigation().dispatch(closeDrawer()) here is a no-op because session rows
        // render inside SessionsList's FlatList, where useNavigation() doesn't resolve
        // to the drawer navigator. closeSidebarDrawer() routes through SidebarView's
        // working drawer navigation instead. No-op when there's no drawer (desktop /
        // unmounted), so other call sites (command palette, machine page) are safe.
        closeSidebarDrawer();
        navigateToSession(router, sessionId);
    }
}
