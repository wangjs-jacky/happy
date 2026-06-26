import type { Router } from "expo-router"
import { useRouter } from "expo-router"
import { storage } from '@/sync/storage';
import { trackSessionSwitched } from '@/track';

export function navigateToSession(router: Router, sessionId: string) {
    const session = storage.getState().sessions[sessionId];
    if (session) {
        trackSessionSwitched(session);
    }

    // 统一会话返回逻辑：无论从首页、侧栏切换、最近列表、机器详情还是通知进入，
    // 都先把导航栈弹回首页（新建会话页 '/'），再进入目标会话，使栈恒为
    // [首页, 当前会话]，绝不堆叠多个会话。这样在任意会话内点返回 / Android
    // 物理返回 / iOS 侧滑，都统一直达首页，而不会回到上一个会话。
    //
    // canDismiss() 为 true 表示当前栈里在首页之上还压着别的屏（会话或其子页），
    // 先用 dismissTo 弹回首页；已经在首页时跳过，避免无谓的 POP_TO。
    if (router.canDismiss()) {
        router.dismissTo('/');
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
