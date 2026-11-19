import * as React from 'react';
import { getCurrentAuth, useAuth } from '@/auth/AuthContext';
import { getServerUrl } from '@/sync/serverConfig';
import { storage, useSessions } from '@/sync/storage';
import type { Session } from '@/sync/storageTypes';
import type { ModeOption } from '@/components/modelModeOptions';
import { machineSpawnNewSession, sessionRefreshModels } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useCodexAccounts } from './useCodexAccounts';
import { useNativeCodexModels } from './useNativeCodexModels';
import { useNavigateToSession } from './useNavigateToSession';
import { buildConnectionModelOptions, connectionModelKey, type CodexConnection } from '@/utils/modelConnections';
import { createConnectionModelSelection } from '@/utils/connectionModelSelection';

export function useSessionModelConnections(session: Session, currentModels: ModeOption[], currentModel: ModeOption | null, onSameConnection: (key: string) => void, ownership: { active: boolean; isRouteCurrent?: () => boolean } = { active: true }) {
    const accounts = useCodexAccounts();
    const sessions = useSessions();
    const machineId = session.metadata?.machineId;
    const native = useNativeCodexModels(machineId);
    const navigate = useNavigateToSession();
    const { credentials } = useAuth();
    const server = getServerUrl();
    const connection = React.useMemo<CodexConnection>(() => session.metadata?.codexAccountProfileId
        ? { type: 'account', profileId: session.metadata.codexAccountProfileId } : { type: 'native' }, [session.metadata?.codexAccountProfileId]);
    const enabled = session.metadata?.flavor === 'codex' && !!machineId && !!session.metadata.path;
    const options = React.useMemo(() => enabled ? buildConnectionModelOptions({
        machineId: machineId!, sessions, profiles: accounts.profiles, currentConnection: connection, currentModels,
        nativeModels: native.models, nativeLabel: t('agentInput.model.localConnection'), automaticLabel: t('agentInput.model.cliAutomatic'), newSessionLabel: t('agentInput.model.opensNewSession'),
    }) : [], [enabled, machineId, sessions, accounts.profiles, connection, currentModels, native.models]);
    const scope = React.useMemo(() => ({ id: session.id, machineId, credentials, server, connection, active: ownership.active }), [session.id, machineId, credentials, server, connection, ownership.active]);
    const latest = React.useRef(scope); latest.current = scope;
    const alive = React.useRef(true);
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const current = React.useCallback(() => alive.current && latest.current === scope && scope.active && ownership.isRouteCurrent?.() !== false
        && getCurrentAuth()?.credentials === credentials && getServerUrl() === server, [scope, credentials, server, ownership.isRouteCurrent]);
    const [pendingScope, setPendingScope] = React.useState<typeof scope | null>(null);
    const busy = pendingScope === scope;
    // One controller per source scope; catalog refreshes cannot reset its in-flight lock.
    const action = React.useMemo(() => createConnectionModelSelection({
        currentConnection: connection, machineId: machineId ?? '', directory: session.metadata?.path ?? '',
        isCurrent: current, sameConnection: onSameConnection, spawn: machineSpawnNewSession,
        hydrate: id => sync.ensureSessionHydrated(id),
        configure: (id, model) => {
            storage.getState().updateSessionModelMode(id, model);
            storage.getState().updateSessionEffortLevel(id, 'default');
            storage.getState().updateSessionFastMode(id, false);
        }, navigate,
    }), [connection, machineId, session.metadata?.path, current, onSameConnection, navigate]);
    const lock = React.useRef<typeof scope | null>(null);
    const select = React.useCallback(async (key: string) => {
        const option = options.find(item => item.key === key);
        if (!enabled || !option || lock.current === scope) return;
        lock.current = scope; setPendingScope(scope);
        try { await action(option); }
        catch {
            if (current()) Modal.alert(t('common.error'), t('agentInput.model.connectionStartFailed'));
        } finally {
            if (lock.current === scope) lock.current = null;
            if (alive.current) setPendingScope(value => value === scope ? null : value);
        }
    }, [options, enabled, action, current, scope]);
    const refresh = React.useCallback(async () => {
        const results = await Promise.allSettled([
            native.refresh(),
            ...(session.metadata?.capabilities?.codexModelCatalogRefresh ? [sessionRefreshModels(session.id)] : []),
        ]);
        if (results.some(result => result.status === 'rejected')) throw new Error('model-catalog-unavailable');
    }, [native.refresh, session.id, session.metadata?.capabilities?.codexModelCatalogRefresh]);
    return { enabled, busy, options,
        model: currentModel ? options.find(option => option.key === connectionModelKey(connection, currentModel.key)) ?? currentModel : null,
        select, refresh };
}
