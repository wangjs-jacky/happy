import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import type { SystemHealthChartModel } from '@/utils/systemHealth';
import { t } from '@/text';

interface Props {
    chart: SystemHealthChartModel;
    color: string;
    timeDomain?: readonly [number, number];
}

function formatValue(value: number | null, unit: SystemHealthChartModel['unit']): string {
    if (value === null || !Number.isFinite(value)) return '—';
    if (unit === 'percent') return `${value.toFixed(1)}%`;
    if (unit === 'gigabytes') return `${value.toFixed(2)} GB`;
    return Math.round(value).toLocaleString();
}

export const SystemHealthSparkline = React.memo<Props>(({ chart, color, timeDomain }) => {
    const [width, setWidth] = useState(0);
    const height = 52;
    const geometry = useMemo(() => {
        const points = chart.points.filter((point) => Number.isFinite(point.sampledAt));
        const values = points.filter((point) => Number.isFinite(point.value)).map((point) => point.value);
        if (width <= 0 || values.length === 0) return { path: '', isolated: [], latest: null };
        const min = Number.isFinite(chart.min) ? chart.min! : Math.min(...values);
        const max = Number.isFinite(chart.max) ? chart.max! : Math.max(...values);
        const span = max - min || 1;
        const ownTimeMin = points[0]?.sampledAt ?? 0;
        const ownTimeMax = points.at(-1)?.sampledAt ?? ownTimeMin;
        const timeMin = timeDomain?.[0] ?? ownTimeMin;
        const timeMax = timeDomain?.[1] ?? ownTimeMax;
        const timeSpan = timeMax - timeMin || 1;
        const coordinates = points.map((point) => {
            if (!Number.isFinite(point.value)) return null;
            const x = timeMax === timeMin ? width / 2 : Math.max(0, Math.min(width, ((point.sampledAt - timeMin) / timeSpan) * width));
            const y = height - 4 - ((point.value - min) / span) * (height - 8);
            return { x, y };
        });
        const segments: Array<Array<{ x: number; y: number }>> = [];
        let segment: Array<{ x: number; y: number }> = [];
        for (const point of coordinates) {
            if (!point) {
                if (segment.length > 0) segments.push(segment);
                segment = [];
                continue;
            }
            segment.push(point);
        }
        if (segment.length > 0) segments.push(segment);
        const lineSegments = segments.filter((item) => item.length > 1);
        return {
            path: lineSegments.map((item) => item.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')).join(' '),
            isolated: segments.filter((item) => item.length === 1).map((item) => item[0]!),
            latest: segments.at(-1)?.at(-1) ?? null,
        };
    }, [chart.max, chart.min, chart.points, timeDomain, width]);
    const accessibilityLabel = t('machine.systemHealth.chartSummary', {
        label: t(chart.labelKey as never),
        min: formatValue(chart.min, chart.unit),
        max: formatValue(chart.max, chart.unit),
        latest: formatValue(chart.latest, chart.unit),
    });

    return (
        <View
            testID="system-health-sparkline"
            style={styles.container}
            accessible
            accessibilityLabel={accessibilityLabel}
        >
            <View style={styles.header}>
                <Text style={styles.label}>{t(chart.labelKey as never)}</Text>
                <Text style={styles.latest}>{formatValue(chart.latest, chart.unit)}</Text>
            </View>
            <View style={styles.chart} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
                {width > 0 && geometry.latest ? (
                    <Svg width={width} height={height} aria-hidden>
                        <Line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke={color} strokeOpacity={0.16} />
                        {geometry.path ? (
                            <Path d={geometry.path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                        ) : null}
                        {geometry.isolated.map((point, index) => (
                            <Circle key={`${point.x}:${point.y}:${index}`} cx={point.x} cy={point.y} r="3" fill={color} />
                        ))}
                    </Svg>
                ) : (
                    <Text style={styles.collecting}>{t('machine.systemHealth.collectingTrend')}</Text>
                )}
            </View>
            <Text style={styles.range}>
                {t('machine.systemHealth.range', { min: formatValue(chart.min, chart.unit), max: formatValue(chart.max, chart.unit) })}
            </Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.divider,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    label: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 13,
    },
    latest: {
        ...Typography.default('semiBold'),
        color: theme.colors.text,
        fontSize: 13,
    },
    chart: {
        minHeight: 52,
        justifyContent: 'center',
    },
    collecting: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    range: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        fontSize: 11,
        marginTop: 2,
    },
}));
