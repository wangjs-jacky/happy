import type { Router } from "expo-router"
import { useRouter } from "expo-router"
import { storage } from '@/sync/storage';
import { trackSessionSwitched } from '@/track';

export function navigateToSession(router: Router, sessionId: string) {
    const session = storage.getState().sessions[sessionId];
    if (session) {
        trackSessionSwitched(session);
    }

    // Use navigate (not push) so the phone sidebar's front drawer closes. On-device
    // testing showed DrawerActions.closeDrawer() is a no-op for this drawer; what
    // actually dismisses it is the navigate itself — the sidebar's own buttons close
    // the drawer purely via router.navigate(...) (their closeDrawer() call does
    // nothing). A plain router.push() left the drawer stuck open over the session.
    router.navigate(`/session/${encodeURIComponent(sessionId)}`);
}

export function useNavigateToSession() {
    const router = useRouter();
    return (sessionId: string) => {
        navigateToSession(router, sessionId);
    }
}
