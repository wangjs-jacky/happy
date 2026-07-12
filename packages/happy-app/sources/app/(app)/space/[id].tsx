import * as React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { useLocalSetting } from '@/sync/storage';
import { layout } from '@/components/layout';
import { AgentSpaceWorkbench } from '@/components/agents/AgentSpaceWorkbench';

/**
 * 「Agent 空间模式」主页路由 `/space/[id]`。进入某个「我的 Agent」= push 到这里：
 * 主内容区变成该 Agent 的**专属空间**（身份 + 工作台/健康报告 + 本空间会话 + 新建）。
 * Agent 由 id 从「我的 Agent」列表实时解析，被删则回落首页；自绘头（headerShown:false），
 * 「退出空间」= 返回上一屏。宽屏套 layout.maxWidth 居中约束（适配平板/桌面）。
 */
export default React.memo(function AgentSpaceScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const safeArea = useSafeAreaInsets();
    const agents = useLocalSetting('agents');
    const agent = React.useMemo(() => agents.find((a) => a.id === id) ?? null, [agents, id]);

    // Agent 被删/找不到 → 回首页（never show error, just fall back）。
    React.useEffect(() => {
        if (!agent) router.replace('/');
    }, [agent, router]);

    const exit = React.useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.navigate('/');
    }, [router]);

    const navigate = React.useCallback((p: string) => router.push(p as any), [router]);

    if (!agent) return null;

    return (
        <View style={[styles.root, { paddingTop: safeArea.top + 8 }]}>
            <View style={styles.constrained}>
                <AgentSpaceWorkbench agent={agent} onExit={exit} onNavigate={navigate} />
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    constrained: {
        flex: 1,
        width: '100%',
        maxWidth: layout.maxWidth,
        alignSelf: 'center',
    },
}));
