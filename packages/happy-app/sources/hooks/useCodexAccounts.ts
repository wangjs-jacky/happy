import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getCurrentAuth, useAuth } from '@/auth/AuthContext';
import { getServerUrl } from '@/sync/serverConfig';
import { bindCodexAccount, CodexAccountError, deleteCodexAccount, listCodexAccounts, renameCodexAccount,
    type CodexAccountErrorCode, type ListCodexAccountsResponse } from '@/sync/apiCodexAccounts';

type Snapshot = ListCodexAccountsResponse & { loading: boolean; busy: boolean; error: CodexAccountErrorCode | null };
export type CodexAccountsController = Snapshot & {
    rename(profileId: string, name: string): Promise<boolean>;
    remove(profileId: string): Promise<boolean>;
    bind(machineId: string, profileId: string | null, expectedVersion: number): Promise<boolean>;
};

/** Screen-scoped metadata only. Opening the screen and completing mutations are the only reads. */
export function useCodexAccounts(): CodexAccountsController {
    const { credentials } = useAuth();
    const server = getServerUrl();
    const store = useMemo(() => {
        let mounted = false;
        let state: Snapshot = { profiles: [], bindings: [], migration: 'none', loading: true, busy: false, error: null };
        const listeners = new Set<() => void>();
        const current = () => mounted && !!credentials && getCurrentAuth()?.credentials === credentials && getServerUrl() === server;
        const update = (patch: Partial<Snapshot>) => { if (current()) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
        const safeCode = (error: unknown): CodexAccountErrorCode => error instanceof CodexAccountError ? error.code : 'codex-account-operation-failed';
        async function load() {
            if (!current()) return;
            try { const result = await listCodexAccounts(credentials!); update({ ...result, loading: false }); }
            catch (error) { update({ loading: false, bindings: [], error: safeCode(error) }); }
        }
        async function mutate(action: () => Promise<void>): Promise<boolean> {
            if (!current() || state.busy || state.loading) return false;
            update({ busy: true, error: null });
            try { await action(); return current(); }
            catch (error) {
                const code = safeCode(error);
                if (current() && ['binding-version-conflict', 'profile-not-found', 'codex-account-unavailable'].includes(code)) await load();
                update({ error: code }); return false;
            } finally { update({ busy: false }); }
        }
        return {
            getSnapshot: () => state,
            subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
            open: () => {
                mounted = true;
                // AuthProvider publishes its global scope in a parent effect, after child effects.
                if (credentials) void Promise.resolve().then(load);
                else { state = { ...state, loading: false, error: 'authentication-required' }; listeners.forEach(fn => fn()); }
            },
            close: () => { mounted = false; },
            rename: (profileId: string, name: string) => mutate(async () => {
                const { profile } = await renameCodexAccount(credentials!, profileId, name);
                update({ profiles: state.profiles.map(p => p.id === profileId ? profile : p) });
            }),
            remove: (profileId: string) => mutate(async () => {
                await deleteCodexAccount(credentials!, profileId);
                // Clear visible references immediately; the read obtains the server's new binding versions.
                update({ profiles: state.profiles.filter(p => p.id !== profileId), bindings: state.bindings.filter(b => b.profileId !== profileId) });
                await load();
            }),
            bind: (machineId: string, profileId: string | null, expectedVersion: number) => mutate(async () => {
                const { binding } = await bindCodexAccount(credentials!, machineId, { profileId, expectedVersion });
                update({ bindings: state.bindings.map(b => b.machineId === machineId ? binding : b) });
            }),
        };
    }, [credentials, server]);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    useEffect(() => { store.open(); return store.close; }, [store]);
    return { ...state, rename: store.rename, remove: store.remove, bind: store.bind };
}
