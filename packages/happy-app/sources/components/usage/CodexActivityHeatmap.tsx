import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { t } from '@/text';
import { multiplyColorOpacity } from '@/utils/colorOpacity';
import {
    buildActivityCalendar,
    formatActivityTokens,
    getActivityLevel,
    type ActivityDay,
    type ActivitySnapshot,
} from './codexActivityCalendar';

const CELL_SIZE = 13;
const CELL_GAP = 3;
const COLUMN_WIDTH = CELL_SIZE + CELL_GAP;
const MONTH_ROW_HEIGHT = 24;
const LEVEL_OPACITY = [0, 0.3, 0.5, 0.75, 1] as const;

export interface CodexActivityHeatmapProps {
    snapshot: ActivitySnapshot | null;
    language: string;
}

/** Native presentation. The Web implementation owns pointer and keyboard feedback. */
export function CodexActivityHeatmap({ snapshot, language }: CodexActivityHeatmapProps) {
    const { theme } = useUnistyles();
    const calendar = React.useMemo(() => buildActivityCalendar(snapshot), [snapshot]);
    const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
    const [expanded, setExpanded] = React.useState(false);
    const scrollRef = React.useRef<ScrollView>(null);
    const initialScrollDone = React.useRef(false);
    const viewportWidth = React.useRef(0);
    const contentWidth = React.useRef(0);
    const selectedDay = calendar.days.find(day => day.date === selectedDate)
        ?? [...calendar.days].reverse().find(day => day.totalTokens > 0)
        ?? calendar.days.at(-1);
    const monthFormatter = React.useMemo(
        () => new Intl.DateTimeFormat(language, { month: 'short', timeZone: 'UTC' }),
        [language],
    );
    const weekdayFormatter = React.useMemo(
        () => new Intl.DateTimeFormat(language, { weekday: 'narrow', timeZone: 'UTC' }),
        [language],
    );
    const visibleMonths = calendar.months.filter((month, index, months) => (
        index === months.length - 1
        || (months[index + 1].weekIndex - month.weekIndex) * COLUMN_WIDTH >= 28
    ));
    const dayDescription = (day: ActivityDay) => t('machine.codexUsageHeatmapDay', {
        date: day.date,
        tokens: formatActivityTokens(day.totalTokens, language, true),
        sessions: day.sessions,
    });
    const colorForLevel = (level: number) => level === 0
        ? theme.colors.surfaceHigh
        : multiplyColorOpacity(theme.colors.accent, LEVEL_OPACITY[level as 1 | 2 | 3 | 4]);
    const scrollToLatestOnce = () => {
        if (initialScrollDone.current || viewportWidth.current <= 0 || contentWidth.current <= 0) return;
        initialScrollDone.current = true;
        if (contentWidth.current > viewportWidth.current) scrollRef.current?.scrollToEnd({ animated: false });
    };

    if (!snapshot || !selectedDay || !calendar.from || !calendar.to) return null;

    const nonCachedInput = Math.max(0, selectedDay.inputTokens - selectedDay.cachedInputTokens);
    const metrics = [
        { key: 'total', label: t('codexActivity.total'), value: selectedDay.totalTokens },
        { key: 'uncached-input', label: t('codexActivity.uncachedInput'), value: nonCachedInput },
        { key: 'cache-read', label: t('codexActivity.cacheRead'), value: selectedDay.cachedInputTokens },
        { key: 'output', label: t('codexActivity.output'), value: selectedDay.outputTokens },
    ];
    const warnings = (snapshot as ActivitySnapshot & { warnings?: unknown }).warnings;

    return (
        <View style={styles.card} testID="codex-activity-card">
            <View style={styles.header}>
                <Text style={styles.title}>{t('machine.codexUsageHeatmap')}</Text>
                <View style={styles.legend} accessible={false}>
                    <Text style={styles.caption}>{t('machine.codexUsageHeatmapLegend')}</Text>
                    {[0, 1, 2, 3, 4].map(level => (
                        <View key={level} style={[styles.legendCell, { backgroundColor: colorForLevel(level) }]} />
                    ))}
                </View>
            </View>
            <Text style={styles.caption} testID="codex-activity-scope">{t('codexActivity.scope')}</Text>
            <View style={styles.rangeRow}>
                <Text style={styles.caption} testID="codex-activity-range">{`${calendar.from} – ${calendar.to}`}</Text>
                <Text
                    style={styles.caption}
                    accessibilityLabel={`${t('codexActivity.processed')}: ${formatActivityTokens(calendar.total, language, true)}`}
                >
                    {`${t('codexActivity.processed')}: ${formatActivityTokens(calendar.total, language)}`}
                </Text>
            </View>
            <View style={styles.calendarRow}>
                <View
                    style={styles.weekdays}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                >
                    {Array.from({ length: 7 }, (_, weekday) => (
                        <Text key={weekday} style={styles.weekday}>
                            {weekdayFormatter.format(new Date(Date.UTC(2026, 0, 4 + weekday)))}
                        </Text>
                    ))}
                </View>
                <ScrollView
                    ref={scrollRef}
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    testID="codex-usage-heatmap-scroll"
                    onLayout={event => {
                        viewportWidth.current = event.nativeEvent.layout.width;
                        scrollToLatestOnce();
                    }}
                    onContentSizeChange={width => {
                        contentWidth.current = width;
                        scrollToLatestOnce();
                    }}
                >
                    <View
                        style={[styles.calendar, { width: calendar.weeks.length * COLUMN_WIDTH - CELL_GAP }]}
                        testID="codex-usage-heatmap"
                    >
                        {visibleMonths.map(month => (
                            <Text
                                key={month.key}
                                style={[styles.month, { left: month.weekIndex * COLUMN_WIDTH }]}
                                testID={`codex-usage-month-${month.key}`}
                            >
                                {monthFormatter.format(new Date(`${month.date}T00:00:00.000Z`))}
                            </Text>
                        ))}
                        <View style={styles.grid} testID="codex-usage-heatmap-grid">
                            {calendar.weeks.map((week, weekIndex) => (
                                <View key={weekIndex} style={styles.week} testID={`codex-usage-week-${weekIndex}`}>
                                    {week.map((day, dayIndex) => {
                                        if (!day) return <View key={`pad-${dayIndex}`} style={styles.cellFrame} />;
                                        const selected = day.date === selectedDay.date;
                                        return (
                                            <View key={day.date} style={styles.cellFrame}>
                                                <Pressable
                                                    accessibilityRole="button"
                                                    accessibilityLabel={dayDescription(day)}
                                                    accessibilityState={{ selected }}
                                                    hitSlop={1}
                                                    onPress={() => setSelectedDate(day.date)}
                                                    style={[
                                                        styles.cell,
                                                        { backgroundColor: colorForLevel(getActivityLevel(day.totalTokens, calendar.max)) },
                                                    ]}
                                                    testID={`codex-usage-day-${day.date}`}
                                                />
                                                {selected && <View pointerEvents="none" style={styles.selectionRing} />}
                                            </View>
                                        );
                                    })}
                                </View>
                            ))}
                        </View>
                    </View>
                </ScrollView>
            </View>
            {calendar.total === 0 && <Text style={styles.caption}>{t('codexActivity.noActivity')}</Text>}
            <View style={styles.detail} testID="codex-usage-detail">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${dayDescription(selectedDay)}. ${t(expanded ? 'codexActivity.hideDetails' : 'codexActivity.showDetails')}`}
                    accessibilityState={{ expanded }}
                    onPress={() => setExpanded(value => !value)}
                    style={({ pressed }) => [styles.summary, pressed && styles.summaryPressed]}
                    testID="codex-activity-detail-toggle"
                >
                    <View style={styles.summaryText}>
                        <Text style={styles.selectedDate}>{selectedDay.date}</Text>
                        <Text style={styles.caption}>
                            {`${formatActivityTokens(selectedDay.totalTokens, language)} token · ${selectedDay.sessions} ${t('machine.codexUsageSessions')}`}
                        </Text>
                    </View>
                    <Text style={styles.action}>{t(expanded ? 'codexActivity.hideDetails' : 'codexActivity.showDetails')}</Text>
                </Pressable>
                {expanded && (
                    <View style={styles.breakdown} testID="codex-activity-breakdown">
                        {metrics.map(metric => (
                            <View key={metric.key} style={styles.metric}>
                                <Text style={styles.caption}>{metric.label}</Text>
                                <Text
                                    accessibilityLabel={`${metric.label}: ${formatActivityTokens(metric.value, language, true)}`}
                                    selectable
                                    style={styles.metricValue}
                                    testID={`codex-activity-metric-${metric.key}`}
                                >
                                    {formatActivityTokens(metric.value, language)}
                                </Text>
                            </View>
                        ))}
                        <Text style={styles.note}>{t('codexActivity.cacheNote')}</Text>
                    </View>
                )}
            </View>
            {Array.isArray(warnings) && warnings.length > 0 && <Text style={styles.caption}>{t('codexActivity.incomplete')}</Text>}
            <Text style={styles.caption}>
                {`${t('machine.codexUsageScannedAt')}: ${new Date(snapshot.scannedAt).toLocaleString(language, { timeZone: snapshot.timeZone })}${snapshot.timeZone ? ` (${snapshot.timeZone})` : ''}`}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create(theme => ({
    card: {
        marginHorizontal: 12,
        marginTop: 20,
        marginBottom: 24,
        padding: 16,
        gap: 10,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
    title: { color: theme.colors.text, fontSize: 17, fontWeight: '600' },
    caption: { color: theme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendCell: { height: 9, width: 9, borderRadius: 2 },
    rangeRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
    calendarRow: { flexDirection: 'row', gap: 8 },
    weekdays: { paddingTop: MONTH_ROW_HEIGHT + 2, gap: CELL_GAP, width: 18 },
    weekday: { fontSize: 9, lineHeight: CELL_SIZE, height: CELL_SIZE, color: theme.colors.textSecondary, textAlign: 'center' },
    scroll: { flex: 1, flexGrow: 1 },
    scrollContent: { padding: 2, paddingBottom: 10 },
    calendar: { position: 'relative', paddingTop: MONTH_ROW_HEIGHT },
    month: { position: 'absolute', top: 0, fontSize: 10, lineHeight: 14, color: theme.colors.textSecondary },
    grid: { flexDirection: 'row', gap: CELL_GAP },
    week: { gap: CELL_GAP },
    cellFrame: { width: CELL_SIZE, height: CELL_SIZE, position: 'relative' },
    cell: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: 3 },
    selectionRing: {
        position: 'absolute', top: -2, bottom: -2, left: -2, right: -2,
        borderWidth: 1, borderColor: theme.colors.text, borderRadius: 5,
    },
    detail: { borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.surfaceHigh },
    summary: { minHeight: 58, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
    summaryPressed: { backgroundColor: theme.colors.surfacePressed },
    summaryText: { flex: 1, flexShrink: 1, gap: 2 },
    selectedDate: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
    action: { color: theme.colors.text, fontSize: 12, fontWeight: '500', flexShrink: 1 },
    breakdown: { paddingHorizontal: 12, paddingBottom: 12, gap: 12, flexDirection: 'row', flexWrap: 'wrap' },
    metric: { minWidth: 100, flexBasis: '44%', flexGrow: 1, gap: 3 },
    metricValue: { color: theme.colors.text, fontSize: 17, fontWeight: '600' },
    note: { color: theme.colors.textSecondary, fontSize: 11, lineHeight: 17, width: '100%' },
}));
