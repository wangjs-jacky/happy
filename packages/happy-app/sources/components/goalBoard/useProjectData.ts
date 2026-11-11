import * as React from 'react';
import type { z } from 'zod';
import { accountRuntimeCurrent, getRuntimeAccountSelection } from '@/auth/accountRuntime';
import { storage, useMachine, useSocketStatus } from '@/sync/storage';
import { loadGoalProjects, loadProjectGoalBoard } from '@/sync/projectGoals';
import { projectBoardSchema, projectCatalogSchema, projectCacheKey, readProjectCache, writeProjectCache } from '@/sync/projectWorkspaceCache';
import { isMachineOnline } from '@/utils/machineUtils';
import { projectCatalogState } from './projectMachine';

/** Cached content remains visible during a single event/user-triggered refresh. */
export function useCachedProjectResource<T>(key: string, schema: z.ZodType<T>, read: () => Promise<T>, enabled: boolean, revision: string | undefined) {
    const cached = React.useMemo(() => readProjectCache(key, schema), [key, schema]);
    const [state, setState] = React.useState<{ key: string; value: T } | null>(null);
    const [request, setRequest] = React.useState<{ key: string; loading: boolean; error: string | null; fresh: boolean }>({ key, loading: false, error: null, fresh: false });
    const generation = React.useRef(0);
    const context = React.useRef(key); context.current = key;
    const refresh = React.useCallback(async () => {
        if (!enabled) return;
        const epoch = ++generation.current;
        setRequest(previous => ({ key, loading: true, error: null, fresh: previous.key === key && previous.fresh }));
        try {
            const value = await read();
            if (context.current !== key || generation.current !== epoch || !accountRuntimeCurrent()) return;
            writeProjectCache(key, value, revision);
            setState({ key, value });
            setRequest({ key, loading: false, error: null, fresh: true });
        } catch (error) {
            if (context.current === key && generation.current === epoch) setRequest({ key, loading: false, fresh: false, error: error instanceof Error ? error.message : String(error) });
        }
    }, [enabled, key, read, revision]);
    React.useEffect(() => {
        if (enabled) void refresh();
        else setRequest(previous => ({ ...previous, loading: false, fresh: false }));
        return () => { generation.current++; };
    }, [refresh, enabled]);
    return { value: state?.key === key ? state.value : cached?.value ?? null, refresh,
        loading: enabled && request.key === key && request.loading, error: request.key === key ? request.error : null,
        fresh: enabled && request.key === key && request.fresh };
}

export function useProjectData(machineId: string, featurePath?: string) {
    const machine = useMachine(machineId);
    const socket = useSocketStatus();
    const online = !!machine && isMachineOnline(machine);
    const connected = socket.status === 'connected';
    const enabled = !!machineId && online && connected;
    const invalidation = (machine?.daemonState as { goalProjectRevision?: string } | null)?.goalProjectRevision;
    const terminal = storage(state => Object.values(state.sessions)
        .filter(session => session.metadata?.machineId === machineId && session.metadata.path.startsWith(featurePath ?? '\0'))
        .map(session => `${session.id}:${session.agentState?.turnStatus?.status}:${session.agentState?.turnStatus?.updatedAt}`).sort().join('|'));
    // A changed generation must also fence an old mounted hook in account-switch tests.
    const generation = getRuntimeAccountSelection()?.generation;
    const readCatalog = React.useCallback(() => loadGoalProjects(machineId, invalidation), [machineId, generation, invalidation]);
    const boardRevision = `${invalidation ?? ''}:${terminal}`;
    const readBoard = React.useCallback(() => loadProjectGoalBoard(machineId, featurePath!, boardRevision), [machineId, featurePath, generation, boardRevision]);
    const catalog = useCachedProjectResource(projectCacheKey('catalog', machineId), projectCatalogSchema, readCatalog, enabled, invalidation);
    const board = useCachedProjectResource(projectCacheKey('board', machineId, featurePath), projectBoardSchema, readBoard, enabled && !!featurePath, boardRevision);
    const refresh = React.useCallback(async () => { await Promise.all([catalog.refresh(), ...(featurePath ? [board.refresh()] : [])]); }, [catalog.refresh, board.refresh, featurePath]);
    const resource = featurePath ? board : catalog;
    const error = resource.error || catalog.error;
    return { projects: catalog.value ?? [], board: featurePath ? board.value : null,
        loading: resource.loading, error, refresh, offline: !online || !connected, loaded: catalog.value !== null,
        contentLoaded: resource.value !== null, stale: resource.value !== null && (!resource.fresh || resource.loading),
        status: projectCatalogState({ connected, online, loading: resource.loading, loaded: resource.value !== null, error }) };
}
