import * as React from 'react';
import { useFocusEffect } from 'expo-router';
import type { MyAgentProfile } from '@slopus/happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { accountRuntimeCurrent } from '@/auth/accountRuntime';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import type { SpawnSessionArgs } from '@/hooks/useSpawnSession';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { createMyAgentsApi, type MyAgentsApi } from './api';
import { launchMyAgentSession } from './launch';
import { t } from '@/text';

export function useMyAgentCompose(modeValue?: string, id?: string) {
    // Management commands use ordinary chat submission. Only launching a saved
    // assistant needs its role and execution environment attached to a session.
    const mode = modeValue === 'use' ? modeValue : undefined;
    const active = !!mode;
    const { credentials } = useAuth();
    const navigate = useNavigateToSession();
    const [profile, setProfile] = React.useState<MyAgentProfile>();
    const [ready, setReady] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [attempt, setAttempt] = React.useState(0);
    const [sessionId, setSessionId] = React.useState<string>();
    const owner = React.useRef<AbortController | undefined>(undefined);
    const api = React.useRef<MyAgentsApi | undefined>(undefined);
    const busyRef = React.useRef(false);
    useFocusEffect(React.useCallback(() => {
        const controller = new AbortController(); owner.current = controller;
        setProfile(undefined); setReady(false); setBusy(false); setError(''); setSessionId(undefined); busyRef.current = false; api.current = undefined;
        const current = () => owner.current === controller && !controller.signal.aborted && accountRuntimeCurrent();
        if (active) {
            if (!credentials) setError(t('myAgents.signInError'));
            else {
                void (async () => {
                    const client = createMyAgentsApi(credentials, controller.signal); api.current = client;
                    const loaded = id ? await client.get(id) : undefined;
                    if (!current()) return;
                    if (!loaded) throw new Error(t('myAgents.missing'));
                    if (loaded.archived) throw new Error(t('myAgents.archived'));
                    const draft = useNewSessionDraft.getState();
                    draft.setAgentType('codex');
                    if (loaded) {
                        if (loaded.machineId && loaded.machineId !== draft.selectedMachineId) draft.setMachineId(loaded.machineId);
                        if (loaded.directory) draft.setPath(loaded.directory);
                        draft.setModelMode(loaded.model); draft.setEffortLevel(loaded.effort);
                    }
                    setProfile(loaded); setReady(true);
                })().catch(cause => { if (current()) setError((cause as Error).message); });
            }
        }
        return () => { controller.abort(); busyRef.current = false; api.current = undefined; };
    }, [active, credentials, mode, id, attempt]));
    const submit = React.useCallback(async (args: SpawnSessionArgs, accepted: () => void) => {
        const controller = owner.current; const client = api.current;
        if (!active || !ready || !controller || controller.signal.aborted || !client || busyRef.current) return;
        const current = () => owner.current === controller && !controller.signal.aborted && accountRuntimeCurrent();
        busyRef.current = true; setBusy(true); setError('');
        try {
            const directory = args.worktreeKey && !['__none__', '__new__'].includes(args.worktreeKey)
                ? args.worktreeKey : resolveAbsolutePath(args.path?.trim() || '~', args.machine.metadata?.homeDir);
            const result = await launchMyAgentSession({ api: client, profile, machine: args.machine,
                directory, text: args.prompt, isCurrent: current,
                permissionMode: args.permissionMode, modelMode: args.modelMode, effortLevel: args.effortLevel, fastMode: args.fastMode,
                attachments: args.images, onSpawned: value => { if (current()) setSessionId(value); } });
            if (current()) { accepted(); navigate(result); }
        } catch (cause) { if (current()) setError((cause as Error).message); }
        finally { if (current()) { busyRef.current = false; setBusy(false); } }
    }, [active, ready, mode, profile, navigate]);
    return {
        active, ready, busy, error, submit,
        title: profile?.name ?? 'Agent',
        hint: t('myAgents.useHint'),
        placeholder: t('myAgents.usePlaceholder'),
        retry: () => setAttempt(value => value + 1),
        openSession: sessionId ? () => navigate(sessionId) : undefined,
    };
}
