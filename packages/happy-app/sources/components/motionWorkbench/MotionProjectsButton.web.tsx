import * as React from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { MotionProject } from '@slopus/happy-wire';
import { Text } from '@/components/StyledText';
import { DesktopDialogFrame } from '@/components/DesktopDialogFrame';
import { WorkspaceButton as Button } from '@/components/fileWorkspace/WorkspaceButton';
import { useFileWorkspace } from '@/components/fileWorkspace/context';
import { Typography } from '@/constants/Typography';
import { accountRuntimeCurrent, getRuntimeAccountSelection } from '@/auth/accountRuntime';
import { getServerUrl } from '@/sync/serverConfig';
import { useSession, useSocketStatus } from '@/sync/storage';
import { resolveSessionState } from '@/utils/sessionUtils';
import { motionWorkbenchRequest } from '@/sync/motionWorkbench.web';
import { stageSessionMessage } from '@/sync/messageStagingQueueRuntime';
import { Modal } from '@/modal';
import { t } from '@/text';

/** Fixed entry: discovery reads metadata; only choosing a project starts the native editor. */
export function MotionProjectsButton({ sessionId: suppliedSession }: { sessionId?: string }) {
    const workspace = useFileWorkspace();
    const sessionId = suppliedSession ?? workspace?.sessionId ?? '';
    const session = useSession(sessionId);
    const { status } = useSocketStatus();
    const connected = status === 'connected' && !!session && resolveSessionState(session).isConnected;
    const connectedRef = React.useRef(connected); connectedRef.current = connected;
    const { theme } = useUnistyles();
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const [query, setQuery] = React.useState('');
    const [projects, setProjects] = React.useState<MotionProject[]>([]);
    const [truncated, setTruncated] = React.useState(false);
    const sequence = React.useRef(0);
    const working = React.useRef(false);
    const scope = JSON.stringify([getServerUrl(), getRuntimeAccountSelection()?.key, sessionId, workspace?.root]);
    const currentScope = React.useRef(scope); currentScope.current = scope;
    const mounted = React.useRef(false);
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
    React.useEffect(() => { sequence.current++; working.current = false; setOpen(false); setBusy(false); setError(''); setProjects([]); setQuery(''); }, [scope]);
    const current = (id: number, owner: string) => mounted.current && sequence.current === id && currentScope.current === owner && accountRuntimeCurrent();
    const choose = async (project: MotionProject) => {
        if (working.current || !connectedRef.current || !workspace?.openMotionProject) return;
        working.current = true; setBusy(true); setError('');
        const id = ++sequence.current, owner = scope;
        try {
            const verified = await motionWorkbenchRequest(sessionId, 'motionWorkbenchRegister', { projectPath: project.projectPath });
            if (!current(id, owner) || !connectedRef.current) return;
            await workspace.openMotionProject(verified.projectPath);
            if (current(id, owner)) setOpen(false);
        } catch (failure) { if (current(id, owner)) { setError(failure instanceof Error ? failure.message : String(failure)); setOpen(true); } }
        finally { if (current(id, owner)) { working.current = false; setBusy(false); } }
    };
    const load = async (direct: boolean) => {
        if (working.current || !connectedRef.current) return;
        working.current = true; setBusy(true); setError('');
        const id = ++sequence.current, owner = scope;
        try {
            const result = await motionWorkbenchRequest(sessionId, 'motionWorkbenchList', {});
            if (!current(id, owner)) return;
            setProjects(result.projects); setTruncated(result.truncated);
            working.current = false;
            if (direct && result.projects.length === 1 && !result.truncated) await choose(result.projects[0]);
            else setOpen(true);
        } catch (failure) { if (current(id, owner)) { setError(failure instanceof Error ? failure.message : String(failure)); setOpen(true); } }
        finally { if (current(id, owner)) { working.current = false; setBusy(false); } }
    };
    const turn = session?.agentState?.turnStatus;
    const terminal = turn && ['completed', 'failed', 'cancelled'].includes(turn.status) ? `${turn.turnId}:${turn.updatedAt}` : null;
    const previousTurn = React.useRef({ scope, terminal });
    React.useEffect(() => {
        const previous = previousTurn.current; previousTurn.current = { scope, terminal };
        if (open && terminal && previous.scope === scope && previous.terminal !== terminal) void load(false);
    }, [scope, terminal, open]);
    if (!workspace?.enabled || workspace.readOnly || !sessionId || !workspace.openMotionProject) return null;
    const close = () => { sequence.current++; working.current = false; setBusy(false); setOpen(false); setError(''); };
    const register = async () => {
        if (working.current || !connectedRef.current) return;
        const owner = scope, id = ++sequence.current;
        working.current = true; setBusy(true); setOpen(false);
        try {
            const path = await Modal.prompt(t('motionWorkbench.registerProject'), t('motionWorkbench.projectFolderHint'), { placeholder: t('motionWorkbench.projectFolder') });
            if (!current(id, owner)) return;
            if (path === null || !path.trim() || !connectedRef.current) { setOpen(true); return; }
            setError('');
            const project = await motionWorkbenchRequest(sessionId, 'motionWorkbenchRegister', { projectPath: path.trim() });
            if (!current(id, owner)) return;
            working.current = false; await choose(project);
        } catch (failure) { if (current(id, owner)) { setError(failure instanceof Error ? failure.message : String(failure)); setOpen(true); } }
        finally { if (current(id, owner)) { working.current = false; setBusy(false); } }
    };
    const create = async () => {
        if (working.current || !connectedRef.current) return;
        working.current = true; setBusy(true); const id = ++sequence.current, owner = scope;
        try {
            await stageSessionMessage(sessionId, t('motionWorkbench.createMessage'), undefined, 'queue', { displayText: t('motionWorkbench.createProject'), draftText: t('motionWorkbench.createProject') });
            if (current(id, owner)) setOpen(false);
        } catch (failure) { if (current(id, owner)) setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { if (current(id, owner)) { working.current = false; setBusy(false); } }
    };
    const filtered = projects.filter(project => project.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return <>
        <Button label={busy ? t('motionWorkbench.findingProjects') : t('motionWorkbench.library')} icon="film-outline" testID="motion-projects-open" expanded={open} popup="dialog" disabled={busy || !connected} onPress={() => { if (open) close(); else void load(true); }} />
        <DesktopDialogFrame visible={open} title={t('motionWorkbench.projects')} testID="motion-projects-dialog" onClose={close} maxWidth={600}>
            <View style={{ padding: 16, gap: 12, maxHeight: '100%' }}>
                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{t('motionWorkbench.scopeHint')}</Text>
                <TextInput accessibilityLabel={t('motionWorkbench.searchProjects')} placeholder={t('motionWorkbench.searchProjects')} value={query} onChangeText={setQuery}
                    placeholderTextColor={theme.colors.input.placeholder} style={{ ...Typography.default(), padding: 10, borderRadius: 8, backgroundColor: theme.colors.input.background, color: theme.colors.input.text, borderWidth: 1, borderColor: theme.colors.divider }} />
                {!connected && <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textSecondary }}>{t('motionWorkbench.offline')}</Text>}
                {!!error && <Text accessibilityRole="alert" selectable style={{ color: theme.colors.textDestructive }}>{error}</Text>}
                {busy && <ActivityIndicator color={theme.colors.textSecondary} />}
                <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 6 }}>
                    {filtered.map(project => <View key={project.projectPath} style={{ gap: 2 }}>
                        <Button label={project.title} truncate icon="film-outline" testID={`motion-project:${project.projectPath}`} disabled={busy || !connected} onPress={() => { void choose(project); }} />
                        {project.modifiedAt > 0 && <Text style={{ paddingHorizontal: 7, fontSize: 11, color: theme.colors.textSecondary }}>{new Date(project.modifiedAt).toLocaleString()}</Text>}
                    </View>)}
                    {!filtered.length && !busy && !error && connected && <Text style={{ color: theme.colors.textSecondary }}>{projects.length ? t('motionWorkbench.noMatchingProjects') : t('motionWorkbench.emptyProjects')}</Text>}
                </ScrollView>
                {truncated && <Text style={{ color: theme.colors.textSecondary }}>{t('motionWorkbench.limitedProjects')}</Text>}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <Button label={t('motionWorkbench.createProject')} icon="add-outline" disabled={busy || !connected} onPress={() => { void create(); }} />
                    <Button label={t('motionWorkbench.registerProject')} icon="folder-open-outline" disabled={busy || !connected} onPress={() => { void register(); }} />
                    <Button label={t('fileWorkspace.refresh')} icon="refresh-outline" disabled={busy || !connected} onPress={() => { void load(false); }} />
                </View>
            </View>
        </DesktopDialogFrame>
    </>;
}
