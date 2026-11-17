import * as React from 'react';
import { z } from 'zod';
import { getCurrentAuth, useAuth } from '@/auth/AuthContext';
import { getServerUrl } from '@/sync/serverConfig';
import { apiSocket } from '@/sync/apiSocket';
import type { ModeOption } from '@/components/modelModeOptions';

const response = z.object({ type: z.literal('success'), models: z.array(z.object({
    code: z.string().min(1).max(512), value: z.string().min(1).max(1024),
    description: z.string().max(8192).nullish(),
})).max(5000) });
/** Only explicit menu-open/refresh events fetch; scope isolates account, server and machine. */
export function useNativeCodexModels(machineId: string | null | undefined) {
    const { credentials } = useAuth();
    const server = getServerUrl();
    const scope = React.useMemo(() => ({ machineId, credentials, server }), [machineId, credentials, server]);
    const latest = React.useRef(scope); latest.current = scope;
    const mounted = React.useRef(true);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const [catalog, setCatalog] = React.useState<{ scope: typeof scope; models: ModeOption[] } | null>(null);
    const pending = React.useRef<{ scope: typeof scope; promise: Promise<void> } | null>(null);
    const current = React.useCallback(() => mounted.current && latest.current === scope && !!credentials
        && getCurrentAuth()?.credentials === credentials && getServerUrl() === server, [scope, credentials, server]);
    const refresh = React.useCallback((): Promise<void> => {
        if (!machineId || !current()) return Promise.reject(new Error('native-model-catalog-unavailable'));
        if (pending.current?.scope === scope) return pending.current.promise;
        const promise = (async () => {
            const raw = await apiSocket.machineRPC(machineId, 'list-codex-native-models', {}, { timeoutMs: 30_000, overallTimeoutMs: 35_000 });
            if (!current()) return;
            const parsed = response.safeParse(raw);
            if (!parsed.success) throw new Error('native-model-catalog-unavailable');
            setCatalog({ scope, models: parsed.data.models.map(model => ({ key: model.code, name: model.value, description: model.description })) });
        })();
        pending.current = { scope, promise };
        void promise.finally(() => { if (pending.current?.promise === promise) pending.current = null; }).catch(() => undefined);
        return promise;
    }, [machineId, current, scope]);
    return { models: catalog?.scope === scope ? catalog.models : [], refresh };
}
