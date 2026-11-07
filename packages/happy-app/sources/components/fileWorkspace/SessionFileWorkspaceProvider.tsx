import * as React from 'react';
import { Platform } from 'react-native';
import { useDesktopWorkspaceLayout } from '@/hooks/useDesktopWorkspaceLayout';
import { useSession, useSocketStatus } from '@/sync/storage';
import { accountRuntimeCurrent, getRuntimeAccountSelection } from '@/auth/accountRuntime';
import { getServerUrl } from '@/sync/serverConfig';
import { loadFileWorkspaceUI, saveFileWorkspaceUI, loadFileWorkspaceDrafts, saveFileWorkspaceDrafts, loadFileWorkspaceReference, saveFileWorkspaceReference } from '@/sync/persistence';
import { resolveSessionFilePath } from '@/utils/sessionFileLinks';
import { Modal } from '@/modal';
import { t } from '@/text';
import { FileWorkspaceController } from './controller';
import { readWorkspaceText, writeWorkspaceText } from './fileIO';
import { FileWorkspaceContext, type FileReference } from './context';

export function SessionFileWorkspaceProvider({ sessionId, children }: { sessionId: string; children: React.ReactNode }) {
    const session = useSession(sessionId);
    const root = session?.metadata?.path ?? '';
    const { rightPanelAvailable } = useDesktopWorkspaceLayout();
    const enabled = Platform.OS === 'web' && rightPanelAvailable;
    const scope = JSON.stringify([getServerUrl(), getRuntimeAccountSelection()?.key ?? 'legacy', session?.metadata?.machineId ?? sessionId, root, sessionId]);
    return <FileWorkspaceOwner key={scope + sessionId} {...{ sessionId, root, enabled, scope }}>{children}</FileWorkspaceOwner>;
}
function FileWorkspaceOwner({ sessionId, root, enabled, scope, children }: { sessionId: string; root: string; enabled: boolean; scope: string; children: React.ReactNode }) {
    const { status: socketStatus } = useSocketStatus();
    const initial = React.useMemo(() => loadFileWorkspaceUI(scope), [scope]);
    const drafts = React.useRef(loadFileWorkspaceDrafts(scope));
    const controller = React.useMemo(() => new FileWorkspaceController({ root,
        read: path => readWorkspaceText(sessionId, path), write: (path, content, hash) => writeWorkspaceText(sessionId, path, content, hash), isCurrent: accountRuntimeCurrent,
    }), [sessionId, root]);
    const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const [draftCacheError, setDraftCacheError] = React.useState(false);
    const [referenceCacheError, setReferenceCacheError] = React.useState(false);
    const [reference, setReference] = React.useState<FileReference | null>(() => {
        const saved = loadFileWorkspaceReference(scope);
        const resolved = saved && resolveSessionFilePath(saved.path, root);
        return saved && resolved?.withinSessionRoot ? { ...saved, path: resolved.absolutePath } : null;
    });
    const [chatWidth, setChatWidth] = React.useState(initial.width);
    const [maximized, setMaximized] = React.useState(false);
    const restored = React.useRef(false);
    const [restoring, setRestoring] = React.useState(true);
    React.useEffect(() => {
        if (!enabled || !root || socketStatus !== 'connected' || restored.current) return;
        restored.current = true;
        // Restore only previously opened tabs, bounded to twenty by persistence.
        const reads = initial.tabs.map(path => { const draft = drafts.current[path]; return controller.open(path).then(() => { if (draft) controller.restoreDraft(path, draft); }); });
        void Promise.allSettled(reads).then(() => setRestoring(false));
        if (initial.active) void controller.open(initial.active);
        if (!initial.open) controller.setOpen(false);
    }, [controller, enabled, initial, root, socketStatus]);
    const lifetime = React.useRef<object | null>(null);
    React.useEffect(() => {
        const token = {}; lifetime.current = token;
        return () => { queueMicrotask(() => { if (lifetime.current === token) controller.dispose(); }); };
    }, [controller]);
    React.useEffect(() => {
        if (restored.current && !restoring && accountRuntimeCurrent()) saveFileWorkspaceUI(scope, { tabs: snapshot.tabs, active: snapshot.active, open: snapshot.open, width: chatWidth });
    }, [scope, restoring, snapshot.tabs, snapshot.active, snapshot.open, chatWidth]);
    React.useEffect(() => {
        if (restoring || !restored.current || !accountRuntimeCurrent()) return;
        try { setDraftCacheError(!saveFileWorkspaceDrafts(scope, controller.exportDrafts())); } catch { setDraftCacheError(true); }
    }, [scope, restoring, snapshot, controller]);
    React.useEffect(() => {
        if (!enabled || !accountRuntimeCurrent()) return;
        try { saveFileWorkspaceReference(scope, reference); setReferenceCacheError(false); } catch { setReferenceCacheError(true); }
    }, [enabled, scope, reference]);
    const previousSocket = React.useRef(socketStatus);
    React.useEffect(() => {
        const reconnected = socketStatus === 'connected' && previousSocket.current !== 'connected';
        previousSocket.current = socketStatus;
        if (reconnected && restored.current) for (const file of Object.values(controller.getSnapshot().documents)) if (file.phase === 'error') void controller.refresh(file.path);
    }, [controller, socketStatus]);
    const session = useSession(sessionId);
    const turn = session?.agentState?.turnStatus;
    const terminal = ['completed', 'cancelled', 'failed'].includes(turn?.status ?? '') ? `${turn?.turnId}:${turn?.updatedAt}` : null;
    const previousTurn = React.useRef(terminal);
    React.useEffect(() => {
        if (!terminal || previousTurn.current === terminal) return;
        previousTurn.current = terminal;
        for (const path of controller.getSnapshot().tabs) void controller.refresh(path);
    }, [controller, sessionId, terminal]);
    const openReference = React.useCallback(async (raw: string) => {
        if (!enabled || !root || !accountRuntimeCurrent()) return;
        let path = raw;
        if (!raw.includes('/') && !raw.includes('\\')) {
            const matches = controller.getSnapshot().tabs.filter(file => file.split('/').pop() === raw);
            if (matches.length > 1) { Modal.alert(t('fileWorkspace.title'), t('fileWorkspace.ambiguous')); return; }
            if (matches.length === 1) path = matches[0];
        }
        const resolved = resolveSessionFilePath(path, root);
        if (!resolved?.withinSessionRoot) { Modal.alert(t('fileWorkspace.title'), t('fileWorkspace.rootUnavailable')); return; }
        setMaximized(false);
        try { await controller.open(resolved.absolutePath); } catch (error) { Modal.alert(t('fileWorkspace.title'), error instanceof Error && error.message === 'FILE_WORKSPACE_TAB_LIMIT' ? t('fileWorkspace.tooManyTabs') : String(error)); }
    }, [controller, enabled, root, sessionId]);
    return <FileWorkspaceContext.Provider value={{ draftCacheError: draftCacheError || referenceCacheError, enabled, root, controller, snapshot, reference, setReference, openReference, chatWidth, setChatWidth, maximized, setMaximized }}>{children}</FileWorkspaceContext.Provider>;
}
