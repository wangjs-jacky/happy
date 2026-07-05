import * as React from 'react';
import { Text, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { DrawerGestureContext } from 'react-native-drawer-layout';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import type { FinanceChartPoint, SessionFinanceChart } from '@/utils/sessionFinanceCharts';
import {
    arbitrateFinanceChartGesture,
    FINANCE_CHART_HEIGHT,
    FINANCE_CHART_PADDING_BOTTOM,
    FINANCE_CHART_PADDING_LEFT,
    FINANCE_CHART_PADDING_RIGHT,
    FINANCE_CHART_PADDING_TOP,
    FINANCE_CHART_PLOT_HEIGHT,
    FINANCE_CHART_PLOT_WIDTH,
    FINANCE_CHART_WIDTH,
    pickFinanceChartPointIndex,
} from '@/utils/financeChartInteraction';
import { ExternalHorizontalGestureContext } from './ExternalHorizontalGestureContext';

function formatNumber(value: number | null, digits: number = 2): string {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    return value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatVolume(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return 'n/a';
    if (value >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000, 2)}B`;
    if (value >= 1_000_000) return `${formatNumber(value / 1_000_000, 2)}M`;
    if (value >= 1_000) return `${formatNumber(value / 1_000, 1)}K`;
    return String(value);
}

function valueRange(points: FinanceChartPoint[]): { min: number; max: number } {
    const lows = points.map((point) => point.low);
    const highs = points.map((point) => point.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    if (min === max) {
        return { min: min - 1, max: max + 1 };
    }
    const padding = (max - min) * 0.08;
    return { min: min - padding, max: max + padding };
}

function xForIndex(index: number, count: number): number {
    if (count <= 1) return FINANCE_CHART_PADDING_LEFT + FINANCE_CHART_PLOT_WIDTH;
    return FINANCE_CHART_PADDING_LEFT + (index / (count - 1)) * FINANCE_CHART_PLOT_WIDTH;
}

function yForValue(value: number, min: number, max: number): number {
    return FINANCE_CHART_PADDING_TOP + (1 - (value - min) / (max - min)) * FINANCE_CHART_PLOT_HEIGHT;
}

function changeTone(change: number | null): 'up' | 'down' | 'flat' {
    if (change === null || change === 0) return 'flat';
    return change > 0 ? 'up' : 'down';
}

export const FinanceChartCard = React.memo(function FinanceChartCard(props: {
    chart: SessionFinanceChart;
    style?: ViewStyle;
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [selectedIndex, setSelectedIndex] = React.useState(Math.max(0, props.chart.points.length - 1));
    const [layoutWidth, setLayoutWidth] = React.useState(FINANCE_CHART_WIDTH);
    const drawerPan = React.useContext(DrawerGestureContext);
    const externalHorizontalGestures = React.useContext(ExternalHorizontalGestureContext);
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const decided = useSharedValue(false);
    const selected = props.chart.points[selectedIndex] ?? props.chart.points[props.chart.points.length - 1];
    const range = React.useMemo(() => valueRange(props.chart.points), [props.chart.points]);
    const latestTone = changeTone(props.chart.latest.change);
    const latestColor = latestTone === 'up'
        ? '#e83e54'
        : latestTone === 'down'
            ? '#16a765'
            : theme.colors.textSecondary;

    const updateSelectionAtX = React.useCallback((locationX: number) => {
        setSelectedIndex(pickFinanceChartPointIndex({
            locationX,
            layoutWidth,
            pointCount: props.chart.points.length,
        }));
    }, [layoutWidth, props.chart.points.length]);

    const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
        const width = event.nativeEvent.layout.width;
        if (width > 0) setLayoutWidth(width);
    }, []);

    const chartGesture = React.useMemo(() => {
        const pan = Gesture.Pan()
            .manualActivation(true)
            .onTouchesDown((event) => {
                'worklet';
                const touch = event.allTouches[0];
                if (!touch) return;
                startX.value = touch.x;
                startY.value = touch.y;
                decided.value = false;
            })
            .onTouchesMove((event, state) => {
                'worklet';
                if (decided.value) return;
                const touch = event.allTouches[0];
                if (!touch) return;
                const owner = arbitrateFinanceChartGesture({
                    dx: touch.x - startX.value,
                    dy: touch.y - startY.value,
                });
                if (owner === 'undecided') return;
                decided.value = true;
                if (owner === 'parent') {
                    state.fail();
                    return;
                }
                state.activate();
                runOnJS(updateSelectionAtX)(touch.x);
            })
            .onUpdate((event) => {
                'worklet';
                runOnJS(updateSelectionAtX)(event.x);
            });

        const gesturesToBlock = drawerPan
            ? [drawerPan, ...externalHorizontalGestures]
            : externalHorizontalGestures;
        if (gesturesToBlock.length > 0) {
            pan.blocksExternalGesture(...gesturesToBlock);
        }

        const tap = Gesture.Tap()
            .maxDistance(8)
            .onStart((event) => {
                'worklet';
                runOnJS(updateSelectionAtX)(event.x);
            });

        return Gesture.Simultaneous(tap, pan);
    }, [decided, drawerPan, externalHorizontalGestures, startX, startY, updateSelectionAtX]);

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: theme.colors.surface,
                    borderColor: theme.colors.divider,
                },
                props.style,
            ]}
        >
            <View style={styles.header}>
                <View style={styles.titleWrap}>
                    <Text style={styles.eyebrow}>{props.chart.source}</Text>
                    <Text style={styles.title} numberOfLines={1}>{props.chart.name}</Text>
                    <Text style={styles.subtitle} numberOfLines={1}>
                        {props.chart.symbol} / {props.chart.range} / {props.chart.interval}
                    </Text>
                </View>
                <View style={styles.priceWrap}>
                    <Text style={styles.price} numberOfLines={1}>{formatNumber(props.chart.latest.close)}</Text>
                    <Text style={[styles.change, { color: latestColor }]} numberOfLines={1}>
                        {props.chart.latest.change === null ? 'n/a' : `${props.chart.latest.change >= 0 ? '+' : ''}${formatNumber(props.chart.latest.change)}`}
                        {props.chart.latest.changePercent === null ? '' : ` (${props.chart.latest.changePercent >= 0 ? '+' : ''}${formatNumber(props.chart.latest.changePercent)}%)`}
                    </Text>
                </View>
            </View>

            <GestureDetector gesture={chartGesture}>
                <View style={styles.chartFrame} onLayout={handleLayout} collapsable={false}>
                    <Svg width="100%" height={FINANCE_CHART_HEIGHT} viewBox={`0 0 ${FINANCE_CHART_WIDTH} ${FINANCE_CHART_HEIGHT}`}>
                        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const y = FINANCE_CHART_PADDING_TOP + ratio * FINANCE_CHART_PLOT_HEIGHT;
                            return (
                                <Line
                                    key={ratio}
                                    x1={FINANCE_CHART_PADDING_LEFT}
                                    y1={y}
                                    x2={FINANCE_CHART_WIDTH - FINANCE_CHART_PADDING_RIGHT}
                                    y2={y}
                                    stroke={theme.colors.divider}
                                    strokeWidth={0.7}
                                    strokeDasharray="4 5"
                                />
                            );
                        })}
                        {props.chart.points.map((point, index) => {
                            const x = xForIndex(index, props.chart.points.length);
                            const yOpen = yForValue(point.open, range.min, range.max);
                            const yClose = yForValue(point.close, range.min, range.max);
                            const yHigh = yForValue(point.high, range.min, range.max);
                            const yLow = yForValue(point.low, range.min, range.max);
                            const up = point.close >= point.open;
                            const color = up ? '#e83e54' : '#16a765';
                            const candleWidth = Math.max(4, Math.min(10, FINANCE_CHART_PLOT_WIDTH / props.chart.points.length * 0.55));
                            const bodyY = Math.min(yOpen, yClose);
                            const bodyHeight = Math.max(2, Math.abs(yClose - yOpen));
                            return (
                                <React.Fragment key={`${point.date}-${index}`}>
                                    <Line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1.4} />
                                    <Rect
                                        x={x - candleWidth / 2}
                                        y={bodyY}
                                        width={candleWidth}
                                        height={bodyHeight}
                                        fill={color}
                                        rx={1}
                                    />
                                </React.Fragment>
                            );
                        })}
                        {selected ? (
                            <>
                                <Line
                                    x1={xForIndex(selectedIndex, props.chart.points.length)}
                                    y1={FINANCE_CHART_PADDING_TOP}
                                    x2={xForIndex(selectedIndex, props.chart.points.length)}
                                    y2={FINANCE_CHART_HEIGHT - FINANCE_CHART_PADDING_BOTTOM}
                                    stroke={theme.colors.textSecondary}
                                    strokeWidth={1}
                                    strokeDasharray="3 4"
                                />
                                <Circle
                                    cx={xForIndex(selectedIndex, props.chart.points.length)}
                                    cy={yForValue(selected.close, range.min, range.max)}
                                    r={4}
                                    fill={theme.colors.surface}
                                    stroke={theme.colors.text}
                                    strokeWidth={1.5}
                                />
                            </>
                        ) : null}
                    </Svg>
                </View>
            </GestureDetector>

            {selected ? (
                <View style={styles.readout}>
                    <View style={styles.readoutDate}>
                        <Text style={styles.readoutLabel}>Date</Text>
                        <Text style={styles.readoutValue}>{selected.date}</Text>
                    </View>
                    <View style={styles.metricGrid}>
                        {[
                            ['Open', formatNumber(selected.open)],
                            ['High', formatNumber(selected.high)],
                            ['Low', formatNumber(selected.low)],
                            ['Close', formatNumber(selected.close)],
                            ['Vol', formatVolume(selected.volume)],
                        ].map(([label, value]) => (
                            <View key={label} style={styles.metric}>
                                <Text style={styles.readoutLabel}>{label}</Text>
                                <Text style={styles.readoutValue} numberOfLines={1}>{value}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            ) : null}
        </View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14,
        paddingVertical: 14,
        gap: 12,
        marginVertical: 8,
        width: '100%',
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: theme.colors.shadow.opacity * 0.45,
        shadowRadius: 10,
        elevation: 4,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
    },
    titleWrap: {
        flex: 1,
        minWidth: 0,
        gap: 3,
    },
    eyebrow: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 0,
        textTransform: 'uppercase',
    },
    title: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 18,
        lineHeight: 23,
    },
    subtitle: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 16,
    },
    priceWrap: {
        alignItems: 'flex-end',
        maxWidth: 150,
        gap: 3,
    },
    price: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 24,
        lineHeight: 29,
    },
    change: {
        ...Typography.default('semiBold'),
        fontSize: 12,
        lineHeight: 16,
    },
    chartFrame: {
        height: FINANCE_CHART_HEIGHT,
        width: '100%',
        overflow: 'hidden',
    },
    readout: {
        borderRadius: 12,
        backgroundColor: theme.colors.surfaceHighest,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
    },
    readoutDate: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
    },
    metricGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    metric: {
        width: '30%',
        minWidth: 74,
        gap: 2,
    },
    readoutLabel: {
        ...Typography.default('semiBold'),
        color: theme.colors.textSecondary,
        fontSize: 10,
        lineHeight: 12,
        textTransform: 'uppercase',
    },
    readoutValue: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 13,
        lineHeight: 17,
    },
}));
