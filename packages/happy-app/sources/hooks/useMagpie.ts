import * as React from 'react';
import { getCurrentAuth, useAuth } from '@/auth/AuthContext';
import { getServerUrl } from '@/sync/serverConfig';
import { machineMagpie } from '@/sync/apiMagpie';
import type { MagpieAction, MagpieSnapshot } from '@slopus/happy-wire';

export function useMagpie(machineId: string | null, online: boolean) {
    const { credentials } = useAuth();
    const server = getServerUrl();
    const [snapshot, setSnapshot] = React.useState<MagpieSnapshot | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const generation = React.useRef(0);
    const inFlight = React.useRef<number | null>(null);
    const resultScope = React.useRef<{ machineId: string; credentials: unknown; server: string } | null>(null);
    const scope = React.useRef({ machineId, online, credentials, server });
    scope.current = { machineId, online, credentials, server };

    const execute = React.useCallback(async (action: MagpieAction): Promise<boolean> => {
        if (!machineId || !online || !credentials || getCurrentAuth()?.credentials !== credentials || getServerUrl() !== server) return false;
        const epoch = generation.current;
        if (inFlight.current === epoch) return false;
        const current = () => generation.current === epoch && scope.current.machineId === machineId && scope.current.online
            && scope.current.credentials === credentials && scope.current.server === server
            && getCurrentAuth()?.credentials === credentials && getServerUrl() === server;
        inFlight.current = epoch;
        setBusy(true); setFailed(false);
        try {
            const result = await machineMagpie(machineId, action);
            if (!current()) return false;
            resultScope.current = { machineId, credentials, server };
            setSnapshot(result);
            return result.status === 'ready';
        } catch {
            if (current()) { setSnapshot(null); setFailed(true); }
            return false;
        } finally {
            if (inFlight.current === epoch) inFlight.current = null;
            if (current()) setBusy(false);
        }
    }, [machineId, online, credentials, server]);

    React.useEffect(() => {
        const epoch = ++generation.current;
        setSnapshot(null); setBusy(false); setFailed(false);
        // Parent auth effects may publish the active credentials after this child effect.
        if (online) void Promise.resolve().then(() => { if (generation.current === epoch) return execute({ action: 'inspect' }); });
        return () => { ++generation.current; };
    }, [execute, online]);
    const matches = resultScope.current?.machineId === machineId && resultScope.current?.credentials === credentials && resultScope.current?.server === server;
    return { snapshot: matches && online ? snapshot : null, busy, failed, execute };
}
