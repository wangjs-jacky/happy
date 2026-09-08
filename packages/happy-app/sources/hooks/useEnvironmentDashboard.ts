import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useAuth, getCurrentAuth } from '@/auth/AuthContext';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { storage, useAllMachines } from '@/sync/storage';
import { getServerUrl } from '@/sync/serverConfig';
import { inspectMachineEnvironment, applyMachineEnvironment } from '@/environment/environmentOps';
import { createEnvironmentDashboard, type EnvironmentDashboardStore, type EnvironmentDashboardSnapshot } from '@/environment/environmentDashboard';

const stores = new WeakMap<AuthCredentials, { server: string; store: EnvironmentDashboardStore }>();
export type EnvironmentDashboardController = EnvironmentDashboardSnapshot & Pick<EnvironmentDashboardStore, 'scan' | 'update' | 'runSingle' | 'getCandidates' | 'confirmStopped'>;

/** Modal unmounts only unsubscribe. Jobs belong to the authenticated app runtime. */
export function useEnvironmentDashboard(): EnvironmentDashboardController {
    const { credentials } = useAuth();
    const machines = useAllMachines({ includeOffline: true });
    const server = getServerUrl();
    const store = useMemo(() => {
        const cached = credentials ? stores.get(credentials) : undefined;
        if (cached?.server === server) return cached.store;
        const created = createEnvironmentDashboard({
            inspect: inspectMachineEnvironment, apply: applyMachineEnvironment, now: Date.now,
            machines: () => Object.values(storage.getState().machines).sort((a, b) => b.createdAt - a.createdAt),
            active: () => Boolean(credentials) && getCurrentAuth()?.credentials === credentials && getServerUrl() === server,
        });
        if (credentials) stores.set(credentials, { server, store: created });
        return created;
    }, [credentials, server]);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const presence = machines.map(machine => `${machine.id}:${machine.active}`).join('|');
    const previous = useRef({ store, presence: store.getSnapshot().rows.map(row => `${row.machine.id}:${row.machine.active}`).join('|') });
    useEffect(() => { store.setMachines(machines); }, [store, machines]);
    // Automatic inspection on open/reconnect. Running jobs keep their existing observations.
    useEffect(() => {
        const changed = previous.current.store !== store || previous.current.presence !== presence;
        previous.current = { store, presence };
        const snapshot = store.getSnapshot();
        if (changed || (!snapshot.running && !snapshot.scanning)) void store.scan();
    }, [store, presence]);
    return { ...state, scan: store.scan, update: store.update, runSingle: store.runSingle, getCandidates: store.getCandidates, confirmStopped: store.confirmStopped };
}
