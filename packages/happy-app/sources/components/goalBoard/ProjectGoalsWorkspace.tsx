import * as React from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { GoalArtifact, GoalBoardCatalogEntry, GoalProject, GoalTask, GoalTaskSession } from '@slopus/happy-wire';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { storage, useAllMachines, useLocalSetting, useMachine, useSocketStatus } from '@/sync/storage';
import { getRuntimeAccountSelection, accountRuntimeCurrent } from '@/auth/accountRuntime';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useReducedTransparency } from '@/hooks/useReducedTransparency';
import { useDesktopWorkspaceLayout } from '@/hooks/useDesktopWorkspaceLayout';
import { isMachineOnline } from '@/utils/machineUtils';
import { getSessionName } from '@/utils/sessionUtils';
import { ensureSessionHydratedWithRetry } from '@/sync/ensureSessionHydratedWithRetry';
import { machineStartGoalAuthor, type DirectoryEntry } from '@/sync/ops';
import { loadGoalProjects, loadProjectGoalBoard, loadProjectTaskHistory, launchProjectGoalTask, projectGoalRequest, projectTaskFiles, taskApproval, taskCanExecute, projectTaskExecutionAttempted, markProjectTaskExecutionAttempt, clearUndispatchedProjectTaskAttempt, ProjectGoalLaunchError, type ProjectBoardData, type ProjectHistoryCursor } from '@/sync/projectGoals';
import { SessionView } from '@/-session/SessionView';
import { SessionFileWorkspaceProvider } from '@/components/fileWorkspace/SessionFileWorkspaceProvider';
import { FileWorkspace, FileWorkspaceResizeHandle } from '@/components/fileWorkspace/FileWorkspace';
import { useFileWorkspace } from '@/components/fileWorkspace/context';
import { WorkspaceDirectoryTree } from '@/components/fileWorkspace/WorkspaceDirectoryTree';
import { getWorkspaceChatWidth, getWorkspaceChatMaximumWidth } from '@/components/fileWorkspace/documentPresentation';
import { PanelTabs } from '@/components/PanelTabs';
import { DesktopSkinCanvas } from '@/components/DesktopSkinCanvas';
import { Modal } from '@/modal';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { GoalBoardButton as Button } from './GoalBoardButton';
import { RunningTaskBorder } from './RunningTaskBorder';

const requestId = () => `goal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function accountKey() { const a = getRuntimeAccountSelection(); return JSON.stringify([a?.key, a?.generation, a?.serverUrl]); }

function useProjectTaskHistory(machineId: string, featurePath: string, taskId: string) {
    const machine = useMachine(machineId);
    const key = JSON.stringify([accountKey(), machineId, featurePath, taskId]);
    const context = React.useRef(key); context.current = key;
    const epoch = React.useRef(0);
    const [state, setState] = React.useState<{ key: string; sessions: GoalTaskSession[]; nextCursor?: ProjectHistoryCursor }>({ key, sessions: [] });
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const read = React.useCallback(async (cursor?: ProjectHistoryCursor) => {
        const request = ++epoch.current;
        setLoading(true); setError(null);
        try {
            const page = await loadProjectTaskHistory(machineId, featurePath, taskId, cursor);
            if (context.current !== key || epoch.current !== request) return;
            setState(previous => {
                const merged = new Map((previous.key === key ? previous.sessions : []).map(session => [session.sessionId, session]));
                for (const session of page.sessions) merged.set(session.sessionId, session);
                return { key, sessions: [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt || b.sessionId.localeCompare(a.sessionId)),
                    nextCursor: !cursor && previous.key === key && previous.sessions.length > 25 ? previous.nextCursor : page.nextCursor };
            });
        } catch (error) { if (context.current === key && epoch.current === request) setError(error instanceof Error ? error.message : String(error)); }
        finally { if (context.current === key && epoch.current === request) setLoading(false); }
    }, [machineId, featurePath, taskId, key]);
    const invalidation = (machine?.daemonState as { goalProjectRevision?: string } | null)?.goalProjectRevision;
    React.useEffect(() => { void read(); return () => { epoch.current++; }; }, [read, invalidation]);
    return { sessions: state.key === key ? state.sessions : [], nextCursor: state.key === key ? state.nextCursor : undefined, loading, error, read };
}

function useProjectData(machineId: string, featurePath?: string) {
    const machine = useMachine(machineId);
    const socket = useSocketStatus();
    const owner = JSON.stringify([accountKey(), machineId]);
    const [projects, setProjects] = React.useState<{ owner: string; values: GoalProject[] } | null>(null);
    const [board, setBoard] = React.useState<{ owner: string; data: ProjectBoardData } | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);
    const context = React.useRef({ owner, featurePath, machineId });
    context.current = { owner, featurePath, machineId };
    const generation = React.useRef(0);
    const refresh = React.useCallback(async () => {
        const captured = context.current;
        const epoch = ++generation.current;
        if (!captured.machineId) return;
        setLoading(true); setError(null);
        try {
            const [projects, board] = await Promise.all([
                loadGoalProjects(captured.machineId),
                captured.featurePath ? loadProjectGoalBoard(captured.machineId, captured.featurePath) : Promise.resolve(null),
            ]);
            if (context.current.owner !== captured.owner || epoch !== generation.current || !accountRuntimeCurrent()) return;
            setProjects({ owner: captured.owner, values: projects });
            setBoard(board ? { owner: JSON.stringify([captured.owner, captured.featurePath]), data: board } : null);
        } catch (error) {
            if (context.current.owner === captured.owner && epoch === generation.current) setError(error instanceof Error ? error.message : String(error));
        } finally { if (epoch === generation.current) setLoading(false); }
    }, []);
    const invalidation = (machine?.daemonState as { goalProjectRevision?: string } | null)?.goalProjectRevision;
    const terminal = storage(state => Object.values(state.sessions)
        .filter(session => session.metadata?.machineId === machineId && session.metadata.path.startsWith(featurePath ?? '\0'))
        .map(session => `${session.id}:${session.agentState?.turnStatus?.status}:${session.agentState?.turnStatus?.updatedAt}`).sort().join('|'));
    React.useEffect(() => {
        if (machineId && socket.status === 'connected' && machine && isMachineOnline(machine)) void refresh();
        return () => { generation.current++; };
    }, [owner, featurePath, socket.status, machine?.active, invalidation, terminal, refresh]);
    return {
        projects: projects?.owner === owner ? projects.values : [],
        board: board?.owner === JSON.stringify([owner, featurePath]) ? board.data : null,
        loading, error, refresh, offline: !machine || !isMachineOnline(machine),
    };
}

export function ProjectGoalsWorkspace() {
    const params = useLocalSearchParams<{ machine?: string; project?: string; feature?: string; task?: string; conversation?: string; author?: string }>();
    const router = useRouter();
    const machines = useAllMachines({ includeOffline: true });
    const draftMachine = useNewSessionDraft(state => state.selectedMachineId);
    const selectedMachine = machines.find(machine => machine.id === params.machine) ?? machines.find(machine => machine.id === draftMachine) ?? machines[0];
    const machineId = selectedMachine?.id ?? '';
    // Account/machine switches remount the archive owner, so stale async work cannot navigate the new account.
    return <ProjectGoalsOwner key={JSON.stringify([accountKey(), machineId])} machineId={machineId} machines={machines} params={params}
        navigate={values => router.setParams(values)} />;
}

function ProjectGoalsOwner({ machineId, machines, params, navigate }: {
    machineId: string; machines: ReturnType<typeof useAllMachines>;
    params: { project?: string; feature?: string; task?: string; conversation?: string; author?: string };
    navigate: (values: Record<string, string | undefined>) => void;
}) {
    const { theme } = useUnistyles();
    const data = useProjectData(machineId, params.feature);
    const [query, setQuery] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [actionError, setActionError] = React.useState<string | null>(null);
    const [agent, setAgent] = React.useState<'codex' | 'claude'>(() => useNewSessionDraft.getState().agentType === 'claude' ? 'claude' : 'codex');
    const alive = React.useRef(true);
    const scope = JSON.stringify([machineId, params.project, params.feature]);
    const scopeRef = React.useRef(scope); scopeRef.current = scope;
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const project = data.projects.find(project => project.projectPath === params.project);
    const feature = data.board?.snapshot;
    const task = feature?.tasks.find(task => task.id === params.task);
    const skin = useLocalSetting('desktopSkinId');
    const readingWidth = useLocalSetting('desktopReadingWidth');
    const reduced = useReducedTransparency();
    const surface = skin !== 'default' ? (reduced ? theme.colors.desktopSkin.readingSolid : theme.colors.desktopSkin.readingWide) : theme.colors.surface;
    const go = (values: Record<string, string | undefined>) => { setQuery(''); setActionError(null); navigate({ conversation: undefined, author: undefined, ...values }); };
    const chooseProject = (project: GoalProject) => go({ project: project.projectPath, feature: project.features.length ? undefined : project.direct?.featurePath, task: undefined });
    const chooseFeature = (feature: GoalBoardCatalogEntry) => go({ feature: feature.featurePath, task: undefined });
    const organize = async () => {
        if (busy || !machineId) return;
        const owner = accountKey();
        const requestedScope = scope;
        setBusy(true); setActionError(null);
        try {
            const result = await machineStartGoalAuthor(machineId, { scopePath: params.feature ?? params.project, requestId: requestId(), agent });
            if (!alive.current || accountKey() !== owner || scopeRef.current !== requestedScope) return;
            if (result.type !== 'success') throw new Error(result.type === 'error' ? result.errorMessage : 'Archive is unavailable');
            await ensureSessionHydratedWithRetry(result.sessionId);
            if (!alive.current || accountKey() !== owner || scopeRef.current !== requestedScope) return;
            storage.getState().updateSessionDraft(result.sessionId,
                `请使用 goal-first-ops 和 goal-first，帮我整理${params.feature ? '当前子项目的任务' : params.project ? '当前项目及子项目' : '一个新的项目'}。先通过对话对齐目标、最终交付与验收标准，给出只读草案让我确认，再更新档案。任务相互独立，不添加自动依赖执行。\n\n${params.feature ?? params.project ?? '从已安装的 Goal First 项目资料库开始。'}\n\n我的想法：`);
            navigate({ author: result.sessionId, conversation: undefined, task: undefined });
        } catch (error) { if (alive.current) setActionError(error instanceof Error ? error.message : String(error)); }
        finally { if (alive.current) setBusy(false); }
    };
    const tasks = feature?.tasks ?? [];
    return <View style={styles.page} testID="project-goals-workspace">
        {skin !== 'default' && <DesktopSkinCanvas reading photo={false} readingWidth={readingWidth} skin={skin} />}
        <View style={[styles.header, { backgroundColor: surface }]}>
            <View style={styles.line}>
                <Button variant="toolbar" label={t('projectGoals.backProjects')} onPress={() => go({ project: undefined, feature: undefined, task: undefined })}>
                    <Ionicons name="folder-open-outline" size={17} color={theme.colors.textSecondary} /><Text style={styles.body}>{t('projectGoals.allProjects')}</Text>
                </Button>
                {project && <><Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} /><Button variant="toolbar" label={project.title} onPress={() => chooseProject(project)}><Text numberOfLines={1} style={styles.body}>{project.title}</Text></Button></>}
                {feature && feature.featurePath !== project?.projectPath && <><Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} /><Button variant="toolbar" label={feature.title} onPress={() => go({ task: undefined })}><Text numberOfLines={1} style={styles.body}>{feature.title}</Text></Button></>}
            </View>
            <View style={styles.line}>
                <Button variant="toolbar" label={t('projectGoals.refresh')} disabled={data.loading || !machineId || data.offline} onPress={() => { void data.refresh(); }} testID="project-goals-refresh"><Ionicons name="refresh-outline" size={17} color={theme.colors.textSecondary} /></Button>
                <Button variant="toolbar" label={t('projectGoals.agent')} onPress={() => setAgent(value => value === 'codex' ? 'claude' : 'codex')}><Text style={styles.meta}>{agent === 'codex' ? 'Codex' : 'Claude'}</Text></Button>
                <Button variant="toolbar" label={t(params.feature ? 'projectGoals.createTask' : 'projectGoals.createProject')} disabled={busy || !machineId || data.offline} onPress={() => { void organize(); }} testID="project-goals-organize"><Ionicons name="sparkles-outline" size={16} color={theme.colors.textLink} /><Text style={styles.link}>{t(params.feature ? 'projectGoals.createTask' : 'projectGoals.createProject')}</Text></Button>
            </View>
        </View>
        <View style={[styles.machineBar, { backgroundColor: surface }]}>
            <Ionicons name="desktop-outline" size={14} color={theme.colors.textSecondary} />
            <ScrollView horizontal contentContainerStyle={styles.line}>
                {machines.map(machine => <Button variant="toolbar" key={machine.id} selected={machineId === machine.id} label={machine.metadata?.displayName || machine.metadata?.host || machine.id}
                    onPress={() => navigate({ machine: machine.id, project: undefined, feature: undefined, task: undefined, conversation: undefined, author: undefined })}>
                    <Text style={styles.meta}>{machine.metadata?.displayName || machine.metadata?.host || machine.id}{!isMachineOnline(machine) ? ` · ${t('projectGoals.offline')}` : ''}</Text>
                </Button>)}
            </ScrollView>
        </View>
        {(data.error || actionError) && <View style={styles.errorBar} accessibilityRole="alert"><Text style={styles.error}>{data.error || actionError}</Text></View>}
        {data.loading && !data.projects.length && <ActivityIndicator style={{ padding: 24 }} color={theme.colors.textSecondary} />}
        {!machineId ? <Empty text={t('projectGoals.noMachine')} /> : params.author ? <View style={[styles.author, { backgroundColor: surface }]}><Text style={[styles.meta, { padding: 12 }]}>{t('projectGoals.authoringHint')}</Text><SessionView key={params.author} id={params.author} embedded /></View>
            : task && feature ? <TaskWorkspace key={JSON.stringify([machineId, feature.featurePath, task.id])} machineId={machineId} featurePath={feature.featurePath} task={task}
                allTasks={tasks} conversationId={params.conversation} agent={agent} offline={data.offline}
                refresh={data.refresh} selectTask={id => go({ task: id })} selectConversation={id => navigate({ conversation: id })} back={() => go({ task: undefined })} />
            : <ScrollView style={styles.catalog} contentContainerStyle={styles.catalogContent}>
                <View style={styles.catalogHeading}><Text accessibilityRole="header" style={styles.heading}>{feature ? t('projectGoals.tasks') : project ? t('projectGoals.subprojects') : t('projectGoals.allProjects')}</Text>
                    <TextInput style={styles.search} placeholder={t('projectGoals.search')} placeholderTextColor={theme.colors.input.placeholder} value={query} onChangeText={setQuery} accessibilityLabel={t('projectGoals.search')} /></View>
                {params.task && feature && !task && <Text style={styles.error}>{t('projectGoals.taskMissing')}</Text>}
                {feature ? <TaskCards tasks={tasks.filter(task => (task.title + task.goal).toLowerCase().includes(query.toLowerCase()))} onSelect={id => go({ task: id })} />
                    : project ? <View style={styles.grid}>{[...(project.direct ? [project.direct] : []), ...project.features].filter(entry => entry.title.toLowerCase().includes(query.toLowerCase())).map(entry => <CatalogCard key={entry.featurePath} title={entry.featurePath === project.projectPath ? t('projectGoals.tasks') : entry.title} subtitle={t('projectGoals.showTasks')} onPress={() => chooseFeature(entry)} />)}</View>
                        : <View style={styles.grid}>{data.projects.filter(project => project.title.toLowerCase().includes(query.toLowerCase())).map(project => <CatalogCard key={project.projectPath} title={project.title} subtitle={project.features.length ? `${project.features.length} ${t('projectGoals.subprojects')}` : t('projectGoals.tasks')} onPress={() => chooseProject(project)} />)}</View>}
                {!data.loading && !data.projects.length && <Empty text={t('projectGoals.emptyProjects')} />}
                {feature && !tasks.length && <Empty text={t('projectGoals.emptyTasks')} />}
            </ScrollView>}
    </View>;
}

function CatalogCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
    const { theme } = useUnistyles();
    return <View style={styles.catalogCard}><Button variant="row" label={title} onPress={onPress}><View style={styles.cardBody}><Ionicons name="folder-outline" size={24} color={theme.colors.textLink} /><Text style={styles.cardTitle}>{title}</Text><Text style={styles.meta}>{subtitle}</Text></View><Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} /></Button></View>;
}
function ApprovalTag({ task }: { task: GoalTask }) {
    const state = taskApproval(task);
    return <View style={[styles.tag, state === 'accepted' ? styles.acceptedTag : styles.pendingTag]}><Text style={[styles.tagText, state === 'accepted' ? styles.acceptedText : styles.pendingText]}>{t(state === 'accepted' ? 'projectGoals.accepted' : state === 'changed' ? 'projectGoals.changed' : state === 'noCriteria' ? 'projectGoals.noCriteria' : 'projectGoals.notReviewed')}</Text></View>;
}
function TaskCards({ tasks, selectedId, onSelect, onAction, offline, busy, hideExecution }: {
    tasks: GoalTask[]; selectedId?: string; onSelect: (id: string) => void; onAction?: (task: GoalTask, action: 'chat' | 'execute') => void; offline?: boolean; busy?: boolean; hideExecution?: boolean;
}) {
    const { theme } = useUnistyles();
    return <View style={styles.grid}>{tasks.map(task => <View key={task.id} style={[styles.taskCard, selectedId === task.id && styles.selectedCard, task.status === 'running' && styles.runningCard]} testID={`project-task-card-${task.id}`}>
        <Button variant="row" selected={selectedId === task.id} label={task.title} onPress={() => onSelect(task.id)}>
            <View style={styles.cardBody}><View style={styles.line}><Text style={styles.cardTitle}>{task.code ? `${task.code} · ` : ''}{task.title}</Text>{task.status === 'running' && <ActivityIndicator accessibilityLabel={t('projectGoals.running')} size="small" color={theme.colors.textLink} />}</View>
                <Text numberOfLines={2} style={styles.body}>{task.goal || task.title}</Text><Text numberOfLines={2} style={styles.meta}>{task.expectedDeliverables.join(' · ') || t('projectGoals.noFinals')}</Text><ApprovalTag task={task} /></View>
        </Button>
        {onAction && selectedId === task.id && <View style={styles.cardActions}><Button variant="toolbar" label={t('projectGoals.newChat')} disabled={offline || busy} onPress={() => onAction(task, 'chat')}><Ionicons name="chatbubble-outline" size={17} color={theme.colors.textSecondary} /></Button>
            {!hideExecution && taskCanExecute(task) && <Button variant="toolbar" label={t('projectGoals.execute')} disabled={offline || busy} onPress={() => onAction(task, 'execute')}><Ionicons name="play" size={17} color={theme.colors.textLink} /></Button>}</View>}
        <RunningTaskBorder active={task.status === 'running'} />
    </View>)}</View>;
}

type TaskWorkspaceProps = { machineId: string; featurePath: string; task: GoalTask; allTasks: GoalTask[]; conversationId?: string; agent: 'codex' | 'claude'; offline: boolean; refresh: () => Promise<void>; selectTask: (id: string) => void; selectConversation: (id: string) => void; back: () => void };
function TaskWorkspace(props: TaskWorkspaceProps) {
    const { machineId, featurePath, task } = props;
    const binding = React.useMemo(() => projectTaskFiles(machineId, featurePath, task), [machineId, featurePath, task.id, task.indexPath]);
    return <SessionFileWorkspaceProvider sessionId={props.conversationId ?? ''} binding={binding}><TaskWorkspaceContent {...props} /></SessionFileWorkspaceProvider>;
}
function TaskWorkspaceContent(props: TaskWorkspaceProps) {
    const { task, machineId, featurePath, allTasks, selectTask, selectConversation, refresh, back, agent, offline } = props;
    const { theme } = useUnistyles();
    const workspace = useFileWorkspace()!;
    const taskHistory = useProjectTaskHistory(machineId, featurePath, task.id);
    const skin = useLocalSetting('desktopSkinId');
    const reduced = useReducedTransparency();
    const surface = skin !== 'default' ? (reduced ? theme.colors.desktopSkin.readingSolid : theme.colors.desktopSkin.readingWide) : theme.colors.surface;
    const { width: windowWidth } = useWindowDimensions();
    const { rightExpandedWidth } = useDesktopWorkspaceLayout();
    const [rowWidth, setRowWidth] = React.useState(0);
    const [tab, setTab] = React.useState('details');
    const [historyOpen, setHistoryOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [executionAttempted, setExecutionAttempted] = React.useState(() => projectTaskExecutionAttempted(machineId, task));
    const [error, setError] = React.useState<string | null>(null);
    const [chatVisible, setChatVisible] = React.useState(!!props.conversationId);
    const [compactTab, setCompactTab] = React.useState('details');
    const [localHistory, setLocalHistory] = React.useState<GoalTaskSession[]>([]);
    const lifetime = React.useRef({ alive: true });
    const action = React.useRef<{ key: string; id: string; uncertain: boolean } | null>(null);
    React.useEffect(() => { lifetime.current.alive = true; return () => { lifetime.current.alive = false; }; }, []);
    const historyFromStore = storage(state => Object.values(state.sessions).filter(session => session.metadata?.machineId === machineId
        && (session.metadata.path === workspace.root || (session.metadata.goalBoard?.featurePath === featurePath && session.metadata.goalBoard.taskId === task.id)))
        .map(session => `${session.id}:${session.updatedAt}`).sort().join('|'));
    const history = React.useMemo(() => {
        const values = new Map([...taskHistory.sessions, ...localHistory].map(session => [session.sessionId, session]));
        for (const session of Object.values(storage.getState().sessions)) {
            if (session.metadata?.machineId !== machineId || !(session.metadata.path === workspace.root || (session.metadata.goalBoard?.featurePath === featurePath && session.metadata.goalBoard.taskId === task.id))) continue;
            values.set(session.id, { sessionId: session.id, title: session.metadata.summary?.text || values.get(session.id)?.title || session.metadata.name || getSessionName(session), directory: workspace.root, updatedAt: session.updatedAt, executed: (session.seq ?? 0) > 1, active: session.active });
        }
        return [...values.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    }, [taskHistory.sessions, localHistory, historyFromStore, machineId, featurePath, task.id, workspace.root]);
    React.useEffect(() => { if (props.conversationId) void ensureSessionHydratedWithRetry(props.conversationId); }, [props.conversationId]);
    const conversationId = history.some(session => session.sessionId === props.conversationId) ? props.conversationId : undefined;
    const start = async (target: GoalTask, mode: 'chat' | 'execute', keepFileVisible = false) => {
        if (busy || offline) return;
        if (target.id !== task.id) { selectTask(target.id); return; }
        setBusy(true); setError(null);
        if (mode === 'execute') { markProjectTaskExecutionAttempt(machineId, task); setExecutionAttempted(true); }
        const key = `${target.id}:${mode}`;
        if (!action.current || action.current.key !== key || !action.current.uncertain) action.current = { key, id: requestId(), uncertain: true };
        try {
            const id = await launchProjectGoalTask(machineId, featurePath, target, mode, action.current.id, agent);
            if (!lifetime.current.alive) return;
            action.current.uncertain = false;
            setLocalHistory(values => [...values, { sessionId: id, title: task.title, directory: workspace.root, updatedAt: Date.now(), executed: mode === 'execute' }]);
            setChatVisible(true); if (!keepFileVisible) setCompactTab('chat'); selectConversation(id);
            await ensureSessionHydratedWithRetry(id);
            if (lifetime.current.alive) await refresh();
        } catch (error) { if (lifetime.current.alive) {
            if (mode === 'execute' && error instanceof ProjectGoalLaunchError && error.notDispatched) { clearUndispatchedProjectTaskAttempt(machineId, task); setExecutionAttempted(false); }
            setError(error instanceof Error ? error.message : String(error)); await refresh();
        } }
        finally { if (lifetime.current.alive) setBusy(false); }
    };
    const openFile = async (path: string) => {
        setChatVisible(true); setCompactTab('file');
        const alreadyOpen = !!workspace.controller.getSnapshot().documents[path];
        void workspace.openReference(path).then(() => { if (alreadyOpen) return workspace.controller.refresh(path); });
        if (!conversationId) {
            if (history[0]) selectConversation(history[0].sessionId);
            else void start(task, 'chat', true);
        }
    };
    const listDirectory = React.useCallback(async (_sessionId: string, path: string) => {
        try { return await projectGoalRequest<{ success: boolean; entries?: DirectoryEntry[]; error?: string }>(machineId, 'goalTaskListDirectory', { featurePath, taskId: task.id, path }); }
        catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) }; }
    }, [machineId, featurePath, task.id]);
    const wide = windowWidth >= 1100;
    const rightWidth = wide ? Math.min(rightExpandedWidth || 340, Math.max(280, rowWidth * 0.3)) : undefined;
    const fileOpen = workspace.enabled && workspace.snapshot.open;
    const chatWidth = getWorkspaceChatWidth(workspace.chatWidth, rowWidth, rightWidth ?? 0);
    const canExecute = taskCanExecute(task) && !executionAttempted && !localHistory.some(session => session.executed) && !taskHistory.sessions.some(session => session.executed);
    const details = <View style={[styles.taskPanel, { backgroundColor: surface }, wide ? { width: rightWidth } : { flex: 1 }]} testID="project-task-panel">
        <View style={styles.panelHeader}><Button variant="toolbar" label={t('projectGoals.backTasks')} onPress={back}><Ionicons name="chevron-back" size={16} color={theme.colors.textSecondary} /><Text style={styles.meta}>{t('projectGoals.backTasks')}</Text></Button><Text numberOfLines={1} style={[styles.cardTitle, { flex: 1 }]}>{task.title}</Text></View>
        <View style={styles.tabs}><PanelTabs activeTab={tab} onTabChange={setTab} testIDPrefix="project-task" tabs={[{ key: 'details', label: t('projectGoals.details'), icon: 'document-text-outline' }, { key: 'files', label: t('projectGoals.files'), icon: 'folder-outline' }]} /></View>
        {tab === 'files' ? <WorkspaceDirectoryTree sessionId={conversationId ?? ''} rootPath={workspace.root} listDirectory={listDirectory} onOpenFile={path => { void openFile(path); }} />
            : <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}><ApprovalTag task={task} /><Field title={t('projectGoals.goal')} values={[task.goal || task.title]} /><Field title={t('projectGoals.expected')} values={task.expectedDeliverables} />
                <Text style={styles.sectionTitle}>{t('projectGoals.finals')}</Text>
                {task.artifacts.filter(artifact => artifact.relation === 'output').map(artifact => <Deliverable key={artifact.id} {...{ artifact, task, machineId, featurePath, refresh }} openFile={openFile} />)}
                {!task.artifacts.some(artifact => artifact.relation === 'output') && <Text style={styles.meta}>{t('projectGoals.noFinals')}</Text>}
                <Field title={t('projectGoals.criteria')} values={task.acceptanceCriteria?.length ? task.acceptanceCriteria : [t('projectGoals.noCriteria')]} />
                <Button variant="toolbar" label={t('projectGoals.editWithAI')} disabled={busy || offline} onPress={() => { void start(task, 'chat'); }}><Ionicons name="sparkles-outline" size={14} color={theme.colors.textLink} /><Text style={styles.link}>{t('projectGoals.editWithAI')}</Text></Button>
            </ScrollView>}
        {error && <Text accessibilityRole="alert" style={[styles.error, { padding: 12 }]}>{error}</Text>}
        {task.execution?.state === 'uncertain' && <Text style={[styles.meta, { paddingHorizontal: 14, paddingVertical: 6 }]}>{t('projectGoals.executionUncertain')}</Text>}
        <View style={styles.footer}><Button variant="primary" label={t('projectGoals.newChat')} disabled={busy || offline} onPress={() => { void start(task, 'chat'); }} testID="project-task-new-chat"><Ionicons name="chatbubble-outline" size={16} color={theme.colors.text} /><Text style={styles.body}>{t('projectGoals.newChat')}</Text></Button>
            {canExecute && <Button variant="primary" label={t('projectGoals.execute')} disabled={busy || offline} onPress={() => { void start(task, 'execute'); }} testID="project-task-execute"><Ionicons name="play" size={16} color={theme.colors.textLink} /><Text style={styles.link}>{t('projectGoals.execute')}</Text></Button>}{busy && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}</View>
    </View>;
    const chat = <View style={[styles.chat, { backgroundColor: surface }, wide && fileOpen && !workspace.maximized ? { flex: 0, width: chatWidth, minWidth: 310 } : {}]}>
        <View style={styles.historyHeader}><Button variant="toolbar" label={t('projectGoals.backTasks')} onPress={() => { setChatVisible(false); selectConversation(''); }}><Ionicons name="grid-outline" size={16} color={theme.colors.textSecondary} /></Button>
            <Button variant="toolbar" label={t('projectGoals.history')} expanded={historyOpen} onPress={() => setHistoryOpen(value => !value)} testID="project-task-history"><Ionicons name="time-outline" size={15} color={theme.colors.textSecondary} /><Text style={styles.meta}>{t('projectGoals.history')} · {history.length}</Text><Ionicons name="chevron-down" size={12} color={theme.colors.textSecondary} /></Button></View>
        {historyOpen && <ScrollView style={styles.historyList}>{history.map(session => <Button key={session.sessionId} variant="row" label={session.title} selected={conversationId === session.sessionId} onPress={() => { selectConversation(session.sessionId); setHistoryOpen(false); }} testID={`project-task-history-${session.sessionId}`}><View style={styles.cardBody}><Text numberOfLines={2} style={styles.body}>{session.title}</Text><Text style={styles.meta}>{new Date(session.updatedAt).toLocaleString()}</Text></View></Button>)}
            {taskHistory.loading && <ActivityIndicator size="small" color={theme.colors.textSecondary} />}
            {taskHistory.error && <><Text style={styles.error}>{taskHistory.error}</Text><Button label={t('common.retry')} onPress={() => { void taskHistory.read(); }}><Text style={styles.link}>{t('common.retry')}</Text></Button></>}
            {taskHistory.nextCursor && <Button label={t('projectGoals.moreHistory')} disabled={taskHistory.loading} onPress={() => { void taskHistory.read(taskHistory.nextCursor); }}><Text style={styles.link}>{t('projectGoals.moreHistory')}</Text></Button>}
            {!history.length && !taskHistory.loading && <Text style={styles.meta}>{t('projectGoals.noHistory')}</Text>}</ScrollView>}
        {conversationId ? <SessionView key={conversationId} id={conversationId} embedded /> : <View style={styles.empty}><Text style={styles.cardTitle}>{t('projectGoals.emptyChat')}</Text><Text style={styles.meta}>{t('projectGoals.emptyChatHint')}</Text><Button label={t('projectGoals.newChat')} onPress={() => { void start(task, 'chat'); }} disabled={busy || offline}><Text style={styles.link}>{t('projectGoals.newChat')}</Text></Button></View>}
    </View>;
    return <View style={styles.taskArea} onLayout={event => setRowWidth(Math.round(event.nativeEvent.layout.width))}>
        {!wide && <View style={styles.compactTabs}><PanelTabs activeTab={compactTab} onTabChange={setCompactTab} testIDPrefix="project-workspace" tabs={[{ key: 'tasks', label: t('projectGoals.tasks'), icon: 'grid-outline' }, { key: 'chat', label: t('projectGoals.discussion'), icon: 'chatbubble-outline' }, ...(fileOpen ? [{ key: 'file', label: t('projectGoals.files'), icon: 'document-outline' as const }] : []), { key: 'details', label: t('projectGoals.details'), icon: 'reader-outline' }]} /></View>}
        <View style={[styles.workspaceRow, !wide && { flexDirection: 'column' }]}>
            {wide ? <>
                {!workspace.maximized && (chatVisible || conversationId || fileOpen ? chat : <ScrollView style={[styles.catalog, { flex: fileOpen ? 0 : 1 }]} contentContainerStyle={styles.catalogContent}><TaskCards tasks={allTasks} selectedId={task.id} onSelect={selectTask} onAction={(task, mode) => { void start(task, mode); }} busy={busy} offline={offline} hideExecution={executionAttempted} /></ScrollView>)}
                {fileOpen && <>{!workspace.maximized && <FileWorkspaceResizeHandle width={chatWidth} maximumWidth={getWorkspaceChatMaximumWidth(rowWidth, rightWidth ?? 0)} />}<FileWorkspace sessionId={conversationId ?? ''} fileTreeExpanded={tab === 'files'} onToggleFileTree={() => setTab(value => value === 'files' ? 'details' : 'files')} /></>}
                {details}
            </> : compactTab === 'details' ? details : compactTab === 'chat' ? chat : compactTab === 'file' ? <FileWorkspace sessionId={conversationId ?? ''} /> : <ScrollView contentContainerStyle={styles.catalogContent}><TaskCards tasks={allTasks} selectedId={task.id} onSelect={selectTask} /></ScrollView>}
        </View>
    </View>;
}

function Deliverable({ artifact, task, machineId, featurePath, refresh, openFile }: { artifact: GoalArtifact; task: GoalTask; machineId: string; featurePath: string; refresh: () => Promise<void>; openFile: (path: string) => Promise<void> }) {
    const workspace = useFileWorkspace()!;
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [openedLink, setOpenedLink] = React.useState<string | null>(null);
    const { theme } = useUnistyles();
    const document = artifact.path ? workspace.snapshot.documents[artifact.path] : undefined;
    const hasReadVersion = artifact.path ? !!document?.hash && document?.fileRevision === artifact.revision && document?.phase === 'ready' && document.draft === document.content : !!artifact.url && openedLink === artifact.revision;
    const accepted = artifact.approval?.status === 'accepted';
    const approve = async () => {
        if (!hasReadVersion || !artifact.revision || busy) return;
        if (!await Modal.confirm(t('projectGoals.approveTitle'), t(artifact.path ? 'projectGoals.approveMessage' : 'projectGoals.approveLinkMessage'))) return;
        setBusy(true); setError(null);
        try { await projectGoalRequest(machineId, 'goalTaskApprove', { featurePath, taskId: task.id, artifactId: artifact.id, expectedRevision: artifact.revision, expectedHash: document?.hash }); await refresh(); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    return <View style={styles.deliverable}>
        <Button variant="row" label={artifact.name} disabled={!artifact.available} onPress={() => { if (artifact.path) void openFile(artifact.path); else if (artifact.url) void openExternalUrl(artifact.url).then(() => setOpenedLink(artifact.revision ?? null)).catch(error => setError(String(error))); }} testID={`project-deliverable-${artifact.id}`}><Ionicons name={artifact.path ? 'document-outline' : 'open-outline'} size={16} color={theme.colors.textLink} /><View style={styles.cardBody}><Text style={styles.body}>{artifact.name}</Text>{artifact.description && <Text style={styles.meta}>{artifact.description}</Text>}</View></Button>
        <Text style={accepted ? styles.acceptedText : styles.pendingText}>{t(accepted ? 'projectGoals.accepted' : artifact.approval?.status === 'changed' ? 'projectGoals.changed' : 'projectGoals.notReviewed')}</Text>
        {!accepted && <Button label={t(artifact.path ? 'projectGoals.approve' : 'projectGoals.approveLink')} disabled={!hasReadVersion || busy} onPress={() => { void approve(); }} testID={`project-deliverable-approve-${artifact.id}`}><Text style={styles.link}>{t(artifact.path ? 'projectGoals.approve' : 'projectGoals.approveLink')}</Text></Button>}
        {!accepted && !hasReadVersion && <Text style={styles.meta}>{t(artifact.path ? 'projectGoals.readFileFirst' : 'projectGoals.openLinkFirst')}</Text>}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>;
}
function Field({ title, values }: { title: string; values: string[] }) { return <View style={styles.field}><Text style={styles.sectionTitle}>{title}</Text>{values.map((value, index) => <Text key={index} selectable style={styles.body}>{value}</Text>)}</View>; }
function Empty({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.meta}>{text}</Text></View>; }

const styles = StyleSheet.create(theme => ({
    page: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: 'transparent' },
    header: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    line: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
    machineBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 3, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    catalog: { flex: 1, minWidth: 0 }, catalogContent: { padding: 24, gap: 20 },
    catalogHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 },
    heading: { fontSize: 22, color: theme.colors.text, ...Typography.default('semiBold') },
    search: { minWidth: 180, maxWidth: 320, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, color: theme.colors.text, fontSize: 13 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14 },
    catalogCard: { flexGrow: 1, flexBasis: 250, maxWidth: 380, borderRadius: 12, overflow: 'hidden' },
    taskCard: { flexGrow: 1, flexBasis: 255, maxWidth: 380, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, overflow: 'hidden' },
    selectedCard: { borderColor: theme.colors.textLink, backgroundColor: theme.colors.surfaceSelected },
    runningCard: { borderColor: theme.colors.status.connecting },
    cardBody: { flex: 1, minWidth: 0, gap: 10 }, cardTitle: { fontSize: 14, lineHeight: 20, color: theme.colors.text, ...Typography.default('semiBold') },
    body: { fontSize: 13, lineHeight: 21, color: theme.colors.text, ...Typography.default() }, meta: { fontSize: 12, lineHeight: 18, color: theme.colors.textSecondary, ...Typography.default() },
    link: { color: theme.colors.textLink, fontSize: 12, lineHeight: 18, ...Typography.default('semiBold') },
    cardActions: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 7, paddingBottom: 4 },
    tag: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start' },
    tagText: { fontSize: 11, lineHeight: 16, ...Typography.default('semiBold') },
    pendingTag: { backgroundColor: theme.colors.box.warning.background }, pendingText: { color: theme.colors.box.warning.text, fontSize: 11 },
    acceptedTag: { backgroundColor: theme.colors.surfaceSelected }, acceptedText: { color: theme.colors.success, fontSize: 11 },
    taskArea: { flex: 1, minHeight: 0, minWidth: 0 }, workspaceRow: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 10 },
    taskPanel: { minHeight: 0, borderRadius: 16, overflow: 'hidden' }, panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    tabs: { flexDirection: 'row', minHeight: 48, paddingHorizontal: 12, paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    detailScroll: { flex: 1, minHeight: 0 }, detailContent: { padding: 16, gap: 20 }, field: { gap: 7 }, sectionTitle: { fontSize: 12, color: theme.colors.textSecondary, ...Typography.default('semiBold') },
    deliverable: { gap: 9, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider, padding: 10 },
    footer: { padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    chat: { flex: 1, minWidth: 0, minHeight: 0, borderRadius: 16, overflow: 'hidden' }, historyHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    historyList: { maxHeight: 240, padding: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.divider },
    compactTabs: { flexDirection: 'row', padding: 8, minHeight: 48 }, empty: { flex: 1, padding: 28, justifyContent: 'center', alignItems: 'center', gap: 14 },
    errorBar: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: theme.colors.box.error.background }, error: { fontSize: 12, lineHeight: 19, color: theme.colors.textDestructive },
    author: { flex: 1, minHeight: 0, borderRadius: 16, overflow: 'hidden' },
}));
