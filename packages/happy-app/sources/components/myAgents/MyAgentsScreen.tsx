import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { MyAgentProfile } from '@slopus/happy-wire';
import { useAuth } from '@/auth/AuthContext';
import { createMyAgentsApi } from './api';

export const myAgentComposeRoute = (mode: 'create' | 'use' | 'edit', id?: string) =>
    `/new?myAgentMode=${mode}${id ? `&myAgentId=${encodeURIComponent(id)}` : ''}`;

function CatalogButton({ style, ...props }: React.ComponentProps<typeof Pressable>) {
    const [focused, setFocused] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);
    return <Pressable {...props} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} style={state => [typeof style === 'function' ? style(state) : style, hovered && styles.pressed, focused && styles.focused]}/>;
}

/** The catalog is only a launcher. All creation, work and editing happen in chat. */
export function MyAgentsScreen() {
    const { credentials } = useAuth();
    const { theme } = useUnistyles();
    const router = useRouter();
    const { agentId } = useLocalSearchParams<{ agentId?: string }>();
    const [agents, setAgents] = React.useState<MyAgentProfile[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [attempt, setAttempt] = React.useState(0);
    // Retain links from saved cards without bringing back a configuration page.
    React.useEffect(() => {
        if (typeof agentId === 'string') router.replace(myAgentComposeRoute('use', agentId) as any);
    }, [agentId, router]);
    useFocusEffect(React.useCallback(() => {
        const controller = new AbortController();
        setLoading(true); setError(''); setAgents([]);
        if (!credentials) { setLoading(false); return () => controller.abort(); }
        void (async () => {
            const api = createMyAgentsApi(credentials, controller.signal);
            return api.list();
        })().then(profiles => {
            if (!controller.signal.aborted) setAgents(profiles.filter(profile => !profile.archived));
        }).catch(cause => {
            if (!controller.signal.aborted) setError((cause as Error).message);
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [credentials, attempt]));
    return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
            <Text style={styles.heading}>Agents</Text>
            {credentials ? <CatalogButton testID="my-agents-create" accessibilityRole="button" accessibilityLabel="创建 Agent" onPress={() => router.push(myAgentComposeRoute('create') as any)} style={({ pressed }) => [styles.create, { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceSelected }]}>
                <Ionicons name="add" size={20} color={theme.colors.text}/><Text style={styles.buttonText}>创建 Agent</Text>
            </CatalogButton> : null}
        </View>
        <Text style={styles.secondary}>{credentials ? '选择一个助手开始对话，或说说你想创建什么助手。' : '登录后创建和使用你的助手。'}</Text>
        {loading ? <ActivityIndicator color={theme.colors.accent}/> : null}
        {error ? <View style={styles.empty}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><CatalogButton accessibilityRole="button" accessibilityLabel="重试" onPress={() => setAttempt(value => value + 1)} style={styles.action}><Text style={styles.buttonText}>重试</Text></CatalogButton></View> : null}
        {!loading && !error && credentials && !agents.length ? <View style={styles.empty}><Text style={styles.emptyTitle}>你的第一个 Agent，从一句话开始</Text><Text style={styles.secondary}>例如：帮我创建一个狗头军师，帮我分析想法、挑出问题。</Text></View> : null}
        {agents.map(agent => <View key={agent.id} style={styles.card}>
            <CatalogButton testID={`my-agent-${agent.id}`} accessibilityRole="button" accessibilityLabel={`与 ${agent.name} 对话`} onPress={() => router.push(myAgentComposeRoute('use', agent.id) as any)} style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}>
                <View style={styles.avatar}><Ionicons name="person-outline" size={22} color={theme.colors.text}/></View>
                <View style={styles.copy}><Text style={styles.name}>{agent.name}</Text><Text style={styles.secondary} numberOfLines={2}>{agent.summary || agent.instructions}</Text></View>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary}/>
            </CatalogButton>
            <CatalogButton testID={`my-agent-edit-${agent.id}`} accessibilityRole="button" accessibilityLabel={`修改 ${agent.name}`} onPress={() => router.push(myAgentComposeRoute('edit', agent.id) as any)} style={({ pressed }) => [styles.edit, pressed && styles.pressed]}><Ionicons name="create-outline" size={16} color={theme.colors.textSecondary}/><Text style={styles.secondary}>修改</Text></CatalogButton>
        </View>)}
    </ScrollView>;
}

const styles = StyleSheet.create(theme => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface },
    content: { padding: 24, paddingBottom: 48, gap: 16, maxWidth: 800, width: '100%', alignSelf: 'center' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    heading: { fontSize: 26, fontWeight: '600', color: theme.colors.text },
    create: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: 12 },
    buttonText: { color: theme.colors.text, fontSize: 15 },
    secondary: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
    empty: { paddingVertical: 32, gap: 12 },
    emptyTitle: { color: theme.colors.text, fontSize: 18, lineHeight: 26 },
    error: { color: theme.colors.textDestructive, fontSize: 15, lineHeight: 22 },
    action: { minHeight: 44, paddingVertical: 12 },
    card: { borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 16, overflow: 'hidden' },
    cardBody: { flexDirection: 'row', gap: 14, padding: 18, alignItems: 'center', minHeight: 88 },
    copy: { flex: 1, gap: 4 },
    avatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.surfaceSelected, alignItems: 'center', justifyContent: 'center' },
    name: { color: theme.colors.text, fontSize: 17, fontWeight: '600' },
    edit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingHorizontal: 18, minHeight: 44, borderTopWidth: 1, borderTopColor: theme.colors.divider },
    pressed: { backgroundColor: theme.colors.surfacePressed },
    focused: { backgroundColor: theme.colors.surfaceSelected, ...Platform.select({ web: { outlineStyle: 'solid', outlineWidth: 2, outlineColor: theme.colors.accent } as any, default: {} }) },
}));
