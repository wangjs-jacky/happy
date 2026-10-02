import * as React from 'react';
import { firstSubmission, traceFirstSubmissionNavigation } from '@/sync/firstSubmissionRuntime';
import { getFirstSubmissionScope } from '@/sync/firstSubmissionScope';
import { ensureSessionHydratedWithRetry } from '@/sync/ensureSessionHydratedWithRetry';
import { useNavigateToSession } from './useNavigateToSession';
import type { SpawnSessionArgs } from './useSpawnSession';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { getServerUrl } from '@/sync/serverConfig';

export function useFirstSubmission(enabled = true) {
    const pending = React.useSyncExternalStore(firstSubmission.subscribe, firstSubmission.getSnapshot, firstSubmission.getSnapshot);
    const navigate = useNavigateToSession();
    const mounted = React.useRef(true);
    const enabledRef = React.useRef(enabled); enabledRef.current = enabled;
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    React.useEffect(() => {
        if (!enabled || pending?.phase !== 'ready' || !pending.sessionId) return;
        const scope = getFirstSubmissionScope();
        void firstSubmission.dismiss(pending).then(cleared => {
            if (cleared && enabledRef.current && mounted.current && scope && scope === getFirstSubmissionScope() && getServerUrl() === scope.serverUrl) {
                traceFirstSubmissionNavigation(pending.sessionId!);
                navigate(pending.sessionId!);
            }
        });
    }, [enabled, pending, navigate]);
    const submit = React.useCallback((args: SpawnSessionArgs, text: string, released: () => void, accepted: () => void) => {
        if (!enabledRef.current) return Promise.resolve(false);
        const { machine, images, environmentVariables, ...input } = args;
        const directory = args.worktreeKey && !['__none__', '__new__'].includes(args.worktreeKey)
            ? args.worktreeKey : resolveAbsolutePath(args.path?.trim() || '~', machine.metadata?.homeDir);
        return firstSubmission.submit({ ...input, text, attachments: (images ?? []).map(({ id, name }) => ({ id, name })) },
            { images: images ?? [], directory, environmentVariables, released, accepted });
    }, []);
    const checkSession = React.useCallback(async () => {
        const snapshot = firstSubmission.getSnapshot(); const scope = getFirstSubmissionScope();
        const current = () => enabledRef.current && scope !== null && scope === getFirstSubmissionScope() && getServerUrl() === scope.serverUrl;
        if (snapshot?.sessionId && await ensureSessionHydratedWithRetry(snapshot.sessionId, current)
            && mounted.current && current()) navigate(snapshot.sessionId);
    }, [navigate]);
    return { pending: enabled ? pending : null, submit, retry: () => firstSubmission.retry(pending),
        restore: (text: string, omitAttachments: boolean) => firstSubmission.restore(text, omitAttachments ? [] : pending?.attachments ?? [], pending), checkSession };
}
