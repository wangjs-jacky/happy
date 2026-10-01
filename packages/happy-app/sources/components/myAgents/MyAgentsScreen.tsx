import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { MyAgentProfile } from '@slopus/happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { accountRuntimeCurrent } from '@/auth/accountRuntime';
import { useAllMachines } from '@/sync/storage';
import type { SkillEntry } from '@/sync/skills';
import { machineListAgentSkills } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { createMyAgentsApi, type MyAgentsApi } from './api';
import { launchMyAgentSession, missingMyAgentSkills, selectMyAgentMachine } from './launch';

export function MyAgentsScreen() {
    const { credentials } = useAuth();
    const { theme } = useUnistyles();
    const router = useRouter();
    const params = useLocalSearchParams<{ agentId?: string }>();
    const agentId = typeof params.agentId === 'string' ? params.agentId : undefined;
    const machines = useAllMachines();
    const [agents, setAgents] = React.useState<MyAgentProfile[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [request, setRequest] = React.useState('');
    const [task, setTask] = React.useState('');
    const [revision, setRevision] = React.useState('');
    const [preferred, setPreferred] = React.useState<string>();
    const [advanced, setAdvanced] = React.useState(false);
    const [showArchived, setShowArchived] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const busyRef = React.useRef(false);
    const operation = React.useRef(0);
    const skillCheck = React.useRef(0);
    const [pending, setPending] = React.useState<{ sessionId: string; text: string; builder: boolean; agentId?: string }>();
    const [installed, setInstalled] = React.useState<SkillEntry[] | null>(null);
    const [checking, setChecking] = React.useState(false);
    const apiRef = React.useRef<MyAgentsApi | null>(null);
    const owner = React.useRef<AbortController | null>(null);
    const [attempt, setAttempt] = React.useState(0);
    const selected = agents.find(a => a.id === agentId);
    const machine = selectMyAgentMachine(machines, selected?.machineId ?? preferred);
    useFocusEffect(React.useCallback(() => {
        const controller = new AbortController(); owner.current = controller;
        operation.current++; skillCheck.current++; busyRef.current = false;
        setBusy(false); setChecking(false); setInstalled(null);
        setError(''); setLoading(true); setAgents([]); apiRef.current = null;
        if (!credentials) { setLoading(false); return () => controller.abort(); }
        void (async () => {
            const api = createMyAgentsApi(credentials, controller.signal);
            apiRef.current = api;
            const profiles = await api.list();
            if (!controller.signal.aborted) setAgents(profiles);
        })().catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => { controller.abort(); operation.current++; skillCheck.current++; busyRef.current = false; apiRef.current = null; };
    }, [credentials, attempt]));
    React.useEffect(() => { operation.current++; busyRef.current = false; setBusy(false); skillCheck.current++; setChecking(false); setTask(''); setRevision(''); setAdvanced(false); setPending(undefined); setInstalled(null); }, [agentId]);
    const check = React.useCallback(async () => {
        if (!selected || !machine?.active || !selected.directory) return;
        setChecking(true); setInstalled(null); setError('');
        const controller = owner.current;
        const checkId = ++skillCheck.current;
        const current = () => skillCheck.current === checkId && owner.current === controller && !!controller && !controller.signal.aborted && accountRuntimeCurrent();
        try {
            const skills = await machineListAgentSkills(machine.id, selected.directory);
            if (current()) setInstalled(skills);
        } catch (cause) { if (current()) setError((cause as Error).message); }
        finally { if (current()) setChecking(false); }
    }, [selected?.id, selected?.updatedAt, machine?.id, machine?.active]);
    React.useEffect(() => { void check(); }, [check]);
    const begin = () => {
        if (busyRef.current || !apiRef.current || !owner.current || owner.current.signal.aborted) return;
        const controller = owner.current;
        const api = apiRef.current;
        const id = ++operation.current;
        const current = () => operation.current === id && owner.current === controller && !controller.signal.aborted && accountRuntimeCurrent();
        busyRef.current = true; setBusy(true); setError('');
        return { api, current, finish: () => { if (operation.current === id) { busyRef.current = false; if (current()) setBusy(false); } } };
    };
    const run = async (text: string, builder: boolean) => {
        if (!text.trim()) return;
        if (!machine) { setError('请先连接一台执行设备。'); return; }
        const op = begin(); if (!op) return;
        try {
            const sessionId = await launchMyAgentSession({ api: op.api, profile: selected, machine, text, builder, isCurrent: op.current,
                pendingSessionId: pending?.sessionId, onSpawned: sessionId => { if (op.current()) setPending({ sessionId, text, builder, agentId }); } });
            if (op.current()) { setPending(undefined); router.push(`/session/${sessionId}`); }
        } catch (cause) { if (op.current()) setError((cause as Error).message); }
        finally { op.finish(); }
    };
    const archive = async () => {
        if (!selected) return;
        const op = begin(); if (!op) return;
        try {
            if (!selected.archived && !await Modal.confirm('归档 Agent', '保留助手配置和工作记录，可随时恢复。')) return;
            if (!op.current()) return;
            await op.api.request(`/${selected.id}/archive`, { method: 'POST', body: JSON.stringify({ archived: !selected.archived, expectedUpdatedAt: selected.updatedAt }) });
            const profiles = await op.api.list();
            if (op.current()) setAgents(profiles);
        } catch (cause) { if (op.current()) setError((cause as Error).message); }
        finally { op.finish(); }
    };
    const clearPreferences = async () => {
        if (!selected) return;
        const op = begin(); if (!op) return;
        try {
            const latest = await op.api.get(selected.id);
            if (!op.current()) return;
            await op.api.request(`/${latest.id}`, { method: 'PATCH', body: JSON.stringify({ ...latest, preferences: '', expectedUpdatedAt: latest.updatedAt, requestId: `clear-preferences-${latest.updatedAt}` }) });
            const profiles = await op.api.list();
            if (op.current()) setAgents(profiles);
        } catch (cause) { if (op.current()) setError((cause as Error).message); }
        finally { op.finish(); }
    };
    const continueSession = async (id: string) => {
        const op = begin(); if (!op) return;
        try {
            if (!await sync.checkSessionExists(id)) throw new Error('这个会话已被删除，请开始一个新任务。');
            if (op.current()) router.push(`/session/${id}`);
        } catch (cause) { if (op.current()) setError((cause as Error).message); }
        finally { op.finish(); }
    };
    const button = (label: string, action: () => void, disabled = false, selectedState = false, testID?: string) => <Pressable key={testID ?? label} testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, selected: selectedState }} disabled={disabled || busy} onPress={action} style={({ pressed }) => [styles.button, { backgroundColor: selectedState ? theme.colors.surfaceSelected : pressed ? theme.colors.surfacePressed : theme.colors.surface, opacity: disabled || busy ? 0.5 : 1 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
    const field = (label: string, value: string, onChange: (v: string) => void, placeholder: string) => <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline editable={!busy && !pending} placeholder={placeholder} placeholderTextColor={theme.colors.textSecondary} style={styles.input} maxLength={4000}/>;
    const missing = selected && installed ? missingMyAgentSkills(selected, installed) : [];
    const status = selected?.archived ? '已归档' : selected?.setupNotes || missing.length || selected?.skills.some(s => !s.path) ? '待配置' : !machine?.active ? '设备离线' : checking ? '检查 Skills…' : !selected?.machineId || !selected.directory ? '待选择运行环境' : installed ? '可开始对话' : 'Skills 待检查';
    if (!credentials) return <View style={styles.content}><Text style={styles.heading}>我的 Agent</Text><Text style={styles.text}>登录后创建和使用属于你的长期助手。</Text>{button('返回登录', () => router.push('/'))}</View>;
    return <ScrollView keyboardShouldPersistTaps="handled" style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.titleRow}><Ionicons name="people-outline" size={26} color={theme.colors.text}/><Text style={styles.heading}>{selected?.name ?? '我的 Agent'}</Text></View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={theme.colors.accent}/> : !agents.length && error ? button('重新连接', () => setAttempt(v => v + 1)) : null}
        {busy ? <View style={styles.titleRow}><ActivityIndicator color={theme.colors.accent}/><Text style={styles.secondary}>正在准备会话…</Text></View> : null}
        {pending ? <View style={styles.section}><Text style={styles.text}>会话已创建。重试会继续同一会话。</Text>{button('继续完成', () => void run(pending.text, pending.builder))}{button('打开已创建会话', () => router.push(`/session/${pending.sessionId}`))}</View> : null}
        {agentId && !selected && !loading ? <><Text style={styles.text}>没有找到这个 Agent，可能属于另一个账号。</Text>{button('返回我的 Agent', () => router.replace('/my-agents' as any))}</> : selected ? <>
            {button('返回我的 Agent', () => router.push('/my-agents' as any))}
            <Text style={styles.text}>{selected.summary || selected.instructions}</Text><Text testID="my-agent-status" style={styles.secondary}>{status}</Text>
            {selected.setupNotes ? <Text style={styles.text}>{selected.setupNotes}</Text> : null}
            <View style={styles.section}><Text style={styles.sectionTitle}>给它一个任务</Text>{field('Agent 任务', task, setTask, '这次想让它帮你做什么？')}{button('开始对话', () => void run(task, false), !task.trim() || selected.archived || !machine?.active || !!selected.setupNotes || !!missing.length, true, 'my-agent-start')}
            {selected.sessions[0] ? button('继续上次', () => void continueSession(selected.sessions[0].sessionId), false, false, 'my-agent-continue') : null}</View>
            <View style={styles.section}><Text style={styles.sectionTitle}>Skills</Text>{selected.skills.length ? selected.skills.map(skill => <View key={skill.name} style={styles.skill}><Text style={styles.text}>{skill.name}</Text><Text style={styles.secondary}>{skill.reason}</Text><Text style={styles.secondary}>{!skill.path || installed && missing.includes(skill.name) ? '缺少 Skill' : installed ? '文件可用' : '待检查'}</Text></View>) : <Text style={styles.secondary}>尚未绑定 Skills，可通过下方对话添加。</Text>}{button('重新检查 Skills', () => void check(), checking || !machine?.active || !selected.directory)}</View>
            <View style={styles.section}><Text style={styles.sectionTitle}>对话式修改</Text>{field('修改 Agent 的要求', revision, setRevision, '例如：先给初步判断，再问必要的问题')}{button('帮我调整', () => void run(revision, true), !revision.trim() || !machine?.active, false, 'my-agent-edit')}</View>
            <View style={styles.section}><Text style={styles.sectionTitle}>长期偏好</Text><Text style={styles.text}>{selected.preferences || '尚无长期偏好。只保存你明确要求记住的内容。'}</Text>{selected.preferences ? button('清除长期偏好', () => void clearPreferences()) : null}</View>
            <View style={styles.section}><Text style={styles.sectionTitle}>工作记录</Text>{selected.sessions.length ? selected.sessions.map(s => button(s.title || selected.name, () => void continueSession(s.sessionId), false, false, `my-agent-session-${s.sessionId}`)) : <Text style={styles.secondary}>开始第一个任务后，会话会保存在这里。</Text>}</View>
            {button(advanced ? '收起高级信息' : '查看职责和运行配置', () => setAdvanced(v => !v))}
            {advanced ? <View style={styles.section}><Text style={styles.text}>{selected.instructions}</Text><Text style={styles.secondary}>{machine?.metadata?.displayName || machine?.metadata?.host || selected.machineId || '尚未选择设备'}</Text><Text style={styles.secondary}>{selected.directory || '尚未选择目录'}</Text><Text style={styles.secondary}>{selected.model} · {selected.effort}</Text>{button('编辑高级配置', () => router.push(`/agent-profiles?agentId=${selected.id}` as any))}</View> : null}
            {button(selected.archived ? '恢复 Agent' : '归档 Agent', () => void archive())}
        </> : !loading ? <>
            <Text style={styles.secondary}>说说你需要什么助手，Happy 会为它配置职责和 Skills。</Text>
            <View style={styles.section}><Text style={styles.sectionTitle}>一句话创建</Text>{field('想创建什么 Agent', request, setRequest, '帮我创建一个狗头军师，分析想法、挑毛病、做决策')}{button('创建 Agent', () => void run(request, true), !request.trim() || !machine?.active || !apiRef.current, true, 'my-agents-create')}{button('试试狗头军师', () => setRequest('帮我创建一个狗头军师，帮我理清想法、挑战假设、依据事实做决策。别一味迎合我；简单问题直接回答，复杂决策才展开追问。'))}
            <Text style={styles.secondary}>执行设备：{machine?.metadata?.displayName || machine?.metadata?.host || '暂无在线设备'}</Text>{machines.length > 1 ? button(advanced ? '收起设备选择' : '更换执行设备', () => setAdvanced(v => !v)) : null}{advanced ? machines.map(m => button(`${m.metadata?.displayName || m.metadata?.host || m.id}${m.active ? '' : '（离线）'}`, () => setPreferred(m.id), !m.active, m.id === machine?.id)) : null}</View>
            {agents.filter(a => showArchived || !a.archived).map(agent => <Pressable key={agent.id} testID={`my-agent-${agent.id}`} accessibilityRole="button" accessibilityLabel={`打开 ${agent.name}`} onPress={() => router.push(`/my-agents?agentId=${agent.id}` as any)} style={({ pressed }) => [styles.section, { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surface }]}><Text style={styles.sectionTitle}>{agent.name}</Text><Text style={styles.secondary} numberOfLines={2}>{agent.summary || agent.instructions}</Text><Text style={styles.secondary}>{agent.skills.map(s => s.name).join(' · ') || '尚未绑定 Skills'}</Text><Text style={styles.secondary}>{agent.archived ? '已归档' : agent.setupNotes || agent.skills.some(s => !s.path) ? '待配置' : !selectMyAgentMachine(machines, agent.machineId)?.active ? '设备离线' : '打开后检查可用性'}</Text>{agent.sessions[0] ? <Text style={styles.secondary}>最近：{agent.sessions[0].title}</Text> : null}</Pressable>)}
            {!agents.some(a => !a.archived) ? <Text style={styles.secondary}>还没有助手，先创建一个狗头军师试试。</Text> : null}
            {button(showArchived ? '隐藏已归档' : '显示已归档', () => setShowArchived(v => !v))}{button('刷新助手列表', () => setAttempt(v => v + 1))}{button('邀请助手参与群聊', () => router.push('/agent-party-access'))}
        </> : null}
    </ScrollView>;
}

const styles = StyleSheet.create(theme => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { padding: 20, paddingBottom: 48, gap: 16, maxWidth: 800, width: '100%', alignSelf: 'center' },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    heading: { fontSize: 26, fontWeight: '600', color: theme.colors.text },
    section: { padding: 18, gap: 12, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface },
    sectionTitle: { fontSize: 17, fontWeight: '600', color: theme.colors.text },
    text: { color: theme.colors.text, fontSize: 15, lineHeight: 23 },
    secondary: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
    error: { color: theme.colors.textDestructive, fontSize: 15, lineHeight: 22 },
    button: { paddingVertical: 12, paddingHorizontal: 16, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.divider },
    buttonText: { color: theme.colors.text, fontSize: 15 },
    input: { minHeight: 100, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 10, backgroundColor: theme.colors.surface, padding: 12, color: theme.colors.text, fontSize: 16, textAlignVertical: 'top' },
    skill: { gap: 4, paddingVertical: 8 },
}));
