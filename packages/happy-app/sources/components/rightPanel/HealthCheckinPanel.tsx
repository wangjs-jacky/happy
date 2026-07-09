import * as React from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSession } from '@/sync/storage';
import { sessionListDirectory, sessionReadFile, sessionBash } from '@/sync/ops';
import {
    decodeBase64Utf8,
    isReportFilename,
    parseHealthLog,
    todayLocalISO,
    pickSleepView,
    buildExerciseView,
    buildDietView,
    type HealthLog,
} from '@/utils/healthLog';
import { hapticsLight } from '../haptics';
import { useRightSwipePanel } from '../RightSwipePanelHost';
import { t } from '@/text';
import { SleepHeroCard } from './SleepHeroCard';
import { SleepTrendCard } from './SleepTrendCard';
import { HealthDomainSwitcher } from './HealthDomainSwitcher';
import { ExerciseCard } from './ExerciseCard';
import { DietCard } from './DietCard';
import { useLocalSettingMutable } from '@/sync/storage';

/**
 * 健康打卡 Agent 的右滑面板：替代通用「能力中心」，展示这个空间自己的东西——
 * 域切换器（睡眠/运动/饮食）+ 对应域的今日摘要 + 本周趋势。数据实时从会话工作目录下的
 * `日报/*.md`（YAML frontmatter）读取（sessionListDirectory + sessionReadFile RPC），
 * 不额外落库。
 *
 * 触发由 SessionView 决定（见 isHealthCheckinSession）；进入这里时 path 一定存在。
 */

const TREND_DAYS = 7;

/**
 * 「本地 Obsidian 同步」是可选增强，只对本人开启：仅当承载本会话的机器上配了
 * `OBSIDIAN_REST_API_KEY`（写在 `~/.zshenv`）时，刷新键才出现、点它才触发同步。
 * 没配这个变量的用户（别人）压根看不到刷新键，只走「读 vault 里的日报」这个基础能力。
 *
 * 两条命令都用 `zsh -c` 包一层：sessionBash 经 `/bin/sh -c` 执行、不加载任何 rc、只继承
 * daemon 的 process.env；而 zsh 每次启动都加载 `~/.zshenv`，key/port 从那里读——不写死进
 * App/OTA 包，key 也永远不会回传到手机。
 */

/** 探针：只回 'yes'/'no' 表示机器上有没有配 key，绝不把 key 值传回手机。用来决定是否显示刷新键。 */
const OBSIDIAN_SYNC_PROBE_CMD =
    'zsh -c \'[ -n "$OBSIDIAN_REST_API_KEY" ] && printf yes || printf no\'';

/**
 * 触发 Obsidian Remotely Save 全量同步。端口默认 27124，可用 `OBSIDIAN_REST_API_PORT` 覆盖。
 * REST 命令「触发即返回」（Remotely Save 后台跑同步、不等完成），故刷新里 curl 之后再等
 * SYNC_SETTLE_MS 让它落盘再读盘。Obsidian 未开 / 命令失败时 sessionBash 返回 { success:false }，
 * 静默忽略、照常读盘（契合本仓库「never show loading error, always just retry」）。
 */
const OBSIDIAN_SYNC_CMD =
    'zsh -c \'curl -sk -m 15 -X POST -H "Authorization: Bearer $OBSIDIAN_REST_API_KEY" "https://127.0.0.1:${OBSIDIAN_REST_API_PORT:-27124}/commands/remotely-save:start-sync/"\'';

/** 触发同步后、重新读盘前，给 Remotely Save 的落盘等待时间（ms）。 */
const SYNC_SETTLE_MS = 2000;

async function readReportText(sessionId: string, filePath: string): Promise<string | null> {
    const res = await sessionReadFile(sessionId, filePath);
    if (!res.success || !res.content) return null;
    try {
        return decodeBase64Utf8(res.content);
    } catch {
        return null;
    }
}

interface PanelData {
    today: HealthLog | null;   // 当天日报（没有则 null → "今天还没记录"）
    trend: HealthLog[];        // 最近若干天（升序），用于趋势展示
}

export const HealthCheckinPanel = React.memo(function HealthCheckinPanel(props: {
    sessionId: string;
    onInsertQuickPrompt?: (prompt: string) => void;
}) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const session = useSession(props.sessionId);
    const path = session?.metadata?.path ?? null;
    // 每次右面板被滑开时重新读盘：新增/修改日报后，重开面板即刷新，
    // 不用等会话有消息流动才更新。首次读展示 spinner，之后静默刷新。
    const panel = useRightSwipePanel();
    const isOpen = panel?.isOpen ?? false;

    const [loading, setLoading] = React.useState(true);
    const [data, setData] = React.useState<PanelData>({ today: null, trend: [] });
    const loadedOnceRef = React.useRef(false);
    // 防止刷新期间（触发同步 + 落盘等待）重复点击叠加多次同步。
    const refreshingRef = React.useRef(false);
    // 手动刷新：点标题栏刷新按钮时自增，触发下面的 effect 重新读盘（不依赖开关动作）。
    const [reloadKey, setReloadKey] = React.useState(0);
    // 「本地 Obsidian 同步」是否可用 = 会话机器上配了 OBSIDIAN_REST_API_KEY。
    // 仅本人配了才为 true，决定是否渲染刷新键；探针只在首次滑开面板时跑一次。
    const [syncAvailable, setSyncAvailable] = React.useState(false);
    const syncProbedRef = React.useRef(false);

    // 当前活跃域：睡眠/运动/饮食
    const [domain, setDomain] = useLocalSettingMutable('healthActiveDomain');

    React.useEffect(() => {
        if (!path || !isOpen) return;
        let cancelled = false;
        (async () => {
            if (!loadedOnceRef.current) setLoading(true);
            const reportsDir = `${path}/日报`;
            const listing = await sessionListDirectory(props.sessionId, reportsDir);
            const files = (listing.entries ?? [])
                .filter((e) => e.type === 'file' && isReportFilename(e.name))
                .map((e) => e.name)
                .sort(); // 文件名即日期，字典序 = 时间序

            const todayName = `${todayLocalISO(new Date())}.md`;
            const recent = files.slice(-TREND_DAYS);
            // 当天日报若不在最近窗口里，也要单独读
            const toRead = Array.from(new Set([...recent, ...(files.includes(todayName) ? [todayName] : [])]));

            const parsed = new Map<string, HealthLog>();
            await Promise.all(
                toRead.map(async (name) => {
                    const text = await readReportText(props.sessionId, `${reportsDir}/${name}`);
                    if (text != null) parsed.set(name, parseHealthLog(name, text));
                }),
            );
            if (cancelled) return;

            const trend = recent.map((n) => parsed.get(n)).filter((x): x is HealthLog => !!x);
            const today = parsed.get(todayName) ?? null;
            setData({ today, trend });
            setLoading(false);
            loadedOnceRef.current = true;
        })();
        return () => {
            cancelled = true;
        };
    }, [props.sessionId, path, isOpen, reloadKey]);

    // 首次滑开面板时探一次：机器上配了 OBSIDIAN_REST_API_KEY 才显示刷新键（探针只回 yes/no，
    // 不把 key 回传手机）。别人没配这个变量就看不到刷新键，只走基础的读盘能力。
    React.useEffect(() => {
        if (!isOpen || syncProbedRef.current) return;
        syncProbedRef.current = true;
        let cancelled = false;
        (async () => {
            const res = await sessionBash(props.sessionId, { command: OBSIDIAN_SYNC_PROBE_CMD, timeout: 10000 });
            if (!cancelled && res.success && res.stdout.trim() === 'yes') {
                setSyncAvailable(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [props.sessionId, isOpen]);

    // 手动刷新：先在会话机器上触发 Obsidian Remotely Save 同步，等它落盘，再重新读盘。
    // 全程转圈给反馈；同步失败静默跳过，仍照常读盘。（仅在 syncAvailable 时才有此键。）
    const refresh = React.useCallback(() => {
        if (refreshingRef.current) return; // 刷新进行中，忽略重复点击
        refreshingRef.current = true;
        hapticsLight();
        loadedOnceRef.current = false;
        setLoading(true); // 立刻转圈：同步 + 落盘等待期间也有反馈，不至于看起来没响应
        (async () => {
            try {
                // sessionBash 自己吞异常、返回 { success:false }，不会 throw；失败即静默跳过。
                await sessionBash(props.sessionId, { command: OBSIDIAN_SYNC_CMD, timeout: 20000 });
                await new Promise((resolve) => setTimeout(resolve, SYNC_SETTLE_MS));
            } finally {
                refreshingRef.current = false;
                setReloadKey((k) => k + 1); // 触发读盘 effect（effect 结束时会关掉 loading）
            }
        })();
    }, [props.sessionId]);

    const insertLog = React.useCallback(() => {
        hapticsLight();
        props.onInsertQuickPrompt?.(t('healthPanel.logTodayPrompt'));
        panel?.closePanel(); // 填入提示词后收起面板，让用户看到输入框、直接发送
    }, [props, panel]);

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
                <Ionicons name="fitness-outline" size={22} color={theme.colors.text} />
                <Text style={styles.title}>{t('healthPanel.title')}</Text>
                <View style={styles.titleSpacer} />
                {/* 仅当会话机器配了 OBSIDIAN_REST_API_KEY 时才显示刷新键（= 触发本地同步的入口）。 */}
                {syncAvailable && (
                    <Pressable onPress={refresh} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
                        <Ionicons name="refresh" size={20} color={theme.colors.textSecondary} />
                    </Pressable>
                )}
            </View>

            {loading ? (
                <View style={styles.loading}>
                    <ActivityIndicator color={theme.colors.textSecondary} />
                </View>
            ) : (
                <>
                    {/* 域切换器：睡眠 / 运动 / 饮食，小点标记今日是否已打卡 */}
                    <HealthDomainSwitcher
                        active={domain}
                        onSelect={setDomain}
                        done={{
                            sleep: !!data.today?.hasSleep,
                            exercise: !!data.today?.hasExercise,
                            diet: !!data.today?.hasDiet,
                        }}
                    />

                    {/* 按域渲染对应内容 */}
                    {domain === 'sleep' && (
                        <>
                            {/* 睡眠 Hero 卡（或空态） */}
                            {(() => {
                                const view = pickSleepView(data.today, data.trend);
                                if (view) {
                                    return <SleepHeroCard view={view} />;
                                }
                                return (
                                    <View style={styles.card}>
                                        <Text style={styles.cardTitle}>{t('healthPanel.todayTitle')}</Text>
                                        <Text style={styles.muted}>{t('healthPanel.notLoggedToday')}</Text>
                                    </View>
                                );
                            })()}

                            {/* 本周睡眠趋势 */}
                            <SleepTrendCard trend={data.trend} />
                        </>
                    )}

                    {domain === 'exercise' && (
                        <ExerciseCard
                            view={data.today ? buildExerciseView(data.today) : null}
                            trend={data.trend}
                        />
                    )}

                    {domain === 'diet' && (
                        <DietCard
                            view={data.today ? buildDietView(data.today) : null}
                            trend={data.trend}
                        />
                    )}

                    {/* 记录今天的打卡 */}
                    <Pressable
                        onPress={insertLog}
                        style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}
                    >
                        <Ionicons name="add-circle-outline" size={20} color={theme.colors.button.primary.tint} />
                        <Text style={styles.logButtonText}>{t('healthPanel.logToday')}</Text>
                    </Pressable>
                </>
            )}
        </ScrollView>
    );
});

/** SessionView 用它判断当前会话是否属于健康打卡 Agent（MVP：按工作目录名识别）。 */
export function isHealthCheckinSession(path: string | null | undefined): boolean {
    return !!path && path.includes('健康打卡');
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    content: {
        padding: 16,
        gap: 16,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    titleSpacer: {
        flex: 1,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.text,
    },
    loading: {
        paddingVertical: 40,
        alignItems: 'center',
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        padding: 14,
        gap: 12,
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.textSecondary,
    },
    muted: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    logButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
    },
    logButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: theme.colors.text,
    },
    pressed: {
        opacity: 0.6,
    },
}));
