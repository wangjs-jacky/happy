import * as React from 'react';
import { ScrollView, View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSession } from '@/sync/storage';
import { sessionListDirectory, sessionReadFile } from '@/sync/ops';
import {
    decodeBase64Utf8,
    isReportFilename,
    parseHealthLog,
    todayLocalISO,
    type HealthLog,
} from '@/utils/healthLog';
import { hapticsLight } from '../haptics';
import { useRightSwipePanel } from '../RightSwipePanelHost';
import { t } from '@/text';

/**
 * 健康打卡 Agent 的右滑面板：替代通用「能力中心」，展示这个空间自己的东西——
 * 今日打卡状态 + 最近睡眠评分趋势。数据实时从会话工作目录下的 `日报/*.md`（YAML
 * frontmatter）读取（sessionListDirectory + sessionReadFile RPC），不额外落库。
 *
 * 触发由 SessionView 决定（见 isHealthCheckinSession）；进入这里时 path 一定存在。
 */

const TREND_DAYS = 7;

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
    trend: HealthLog[];        // 最近若干天（升序），用于睡眠评分趋势
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
    const isOpen = useRightSwipePanel()?.isOpen ?? false;

    const [loading, setLoading] = React.useState(true);
    const [data, setData] = React.useState<PanelData>({ today: null, trend: [] });
    const loadedOnceRef = React.useRef(false);
    // 手动刷新：点标题栏刷新按钮时自增，触发下面的 effect 重新读盘（不依赖开关动作）。
    const [reloadKey, setReloadKey] = React.useState(0);

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

    const refresh = React.useCallback(() => {
        hapticsLight();
        loadedOnceRef.current = false; // 手动刷新时显示 spinner，给用户明确反馈
        setReloadKey((k) => k + 1);
    }, []);

    const insertLog = React.useCallback(() => {
        hapticsLight();
        props.onInsertQuickPrompt?.(t('healthPanel.logTodayPrompt'));
    }, [props]);

    const maxScore = React.useMemo(
        () => Math.max(100, ...data.trend.map((d) => d.sleepScore ?? 0)),
        [data.trend],
    );

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.titleRow}>
                <Ionicons name="fitness-outline" size={22} color={theme.colors.text} />
                <Text style={styles.title}>{t('healthPanel.title')}</Text>
                <View style={styles.titleSpacer} />
                <Pressable onPress={refresh} hitSlop={10} style={({ pressed }) => pressed && styles.pressed}>
                    <Ionicons name="refresh" size={20} color={theme.colors.textSecondary} />
                </Pressable>
            </View>

            {loading ? (
                <View style={styles.loading}>
                    <ActivityIndicator color={theme.colors.textSecondary} />
                </View>
            ) : (
                <>
                    {/* 今日打卡 */}
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{t('healthPanel.todayTitle')}</Text>
                        {data.today ? (
                            <View style={styles.chipsRow}>
                                <CategoryChip on={data.today.hasExercise} label={t('healthPanel.exercise')} />
                                <CategoryChip on={data.today.hasSleep} label={t('healthPanel.sleep')} />
                                <CategoryChip on={data.today.hasDiet} label={t('healthPanel.diet')} />
                            </View>
                        ) : (
                            <Text style={styles.muted}>{t('healthPanel.notLoggedToday')}</Text>
                        )}
                    </View>

                    {/* 本周睡眠趋势 */}
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{t('healthPanel.sleepTrendTitle')}</Text>
                        {data.trend.some((d) => d.sleepScore != null) ? (
                            <View style={styles.trend}>
                                {data.trend.map((d) => (
                                    <View key={d.date} style={styles.trendRow}>
                                        <Text style={styles.trendDate}>{d.date.slice(5)}</Text>
                                        <View style={styles.barTrack}>
                                            <View
                                                style={[
                                                    styles.barFill,
                                                    { width: `${((d.sleepScore ?? 0) / maxScore) * 100}%` },
                                                ]}
                                            />
                                        </View>
                                        <Text style={styles.trendScore}>
                                            {d.sleepScore != null ? `${d.sleepScore}${t('healthPanel.scoreLabel')}` : '—'}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <Text style={styles.muted}>{t('healthPanel.noTrendData')}</Text>
                        )}
                    </View>

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

const CategoryChip = React.memo(function CategoryChip(props: { on: boolean; label: string }) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    return (
        <View style={[styles.chip, props.on && styles.chipOn]}>
            <Ionicons
                name={props.on ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={props.on ? theme.colors.button.primary.tint : theme.colors.textSecondary}
            />
            <Text style={[styles.chipText, props.on && styles.chipTextOn]}>{props.label}</Text>
        </View>
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
    chipsRow: {
        flexDirection: 'row',
        gap: 8,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 10,
        backgroundColor: theme.colors.surfacePressed,
    },
    chipOn: {
        backgroundColor: theme.colors.button.primary.background,
    },
    chipText: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    chipTextOn: {
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
    },
    muted: {
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    trend: {
        gap: 8,
    },
    trendRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    trendDate: {
        width: 40,
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    barTrack: {
        flex: 1,
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.surfacePressed,
        overflow: 'hidden',
    },
    barFill: {
        height: 10,
        borderRadius: 5,
        backgroundColor: theme.colors.button.primary.background,
    },
    trendScore: {
        width: 44,
        textAlign: 'right',
        fontSize: 12,
        color: theme.colors.text,
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
