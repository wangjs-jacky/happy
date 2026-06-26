import type { Router } from "expo-router"
import { useRouter } from "expo-router"
import { storage } from '@/sync/storage';
import { trackSessionSwitched } from '@/track';
import { closeSidebarDrawer, isSidebarDrawerCloserRegistered } from '@/components/sidebarDrawerControl';
import { Modal } from '@/modal';

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
        // ===== TEMPORARY ON-DEVICE DIAGNOSTIC (remove after root cause found) =====
        // Triggers the registered drawer-close, then shows what happened. The title
        // proves which bundle is running; the body shows whether a closer was found;
        // after dismissing, observe whether the drawer is now closed BEFORE tapping 继续.
        const registered = isSidebarDrawerCloserRegistered();
        closeSidebarDrawer();
        Modal.alert(
            'DEBUG 48c2',
            `closer 已注册: ${registered ? '是' : '否(null)'}\n\n关掉这个弹窗后先看抽屉收没收，再点「继续」进会话。`,
            [{ text: '继续', onPress: () => navigateToSession(router, sessionId) }],
        );
    }
}
