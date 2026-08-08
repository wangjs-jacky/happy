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
}

function formatValue(value: number | null, unit: SystemHealthChartModel['unit']): string {
    if (value === null) return '—';
    if (unit === 'percent') return `${value.toFixed(1)}%`;
    if (unit === 'gigabytes') return `${value.toFixed(2)} GB`;
    return Math.round(value).toLocaleString();
}

export const SystemHealthSparkline = React.memo<Props>(({ chart, color }) => {
    const [width, setWidth] = useState(0);
    const height = 52;
    const path = useMemo(() => {
        if (width <= 0 || chart.points.length === 0) return '';
        const min = chart.min ?? 0;
        const max = chart.max ?? min;
        const span = max - min || 1;
        const timeMin = chart.points[0]?.sampledAt ?? 0;
        const timeMax = chart.points.at(-1)?.sampledAt ?? timeMin;
        const timeSpan = timeMax - timeMin || 1;
        return chart.points.map((point, index) => {
            const x = ((point.sampledAt - timeMin) / timeSpan) * width;
            const y = height - 4 - ((point.value - min) / span) * (height - 8);
            return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
        }).join(' ');
    }, [chart.max, chart.min, chart.points, width]);
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
                {width > 0 && chart.points.length > 0 ? (
                    <Svg width={width} height={height} accessibilityElementsHidden>
                        <Line x1="0" y1={height - 4} x2={width} y2={height - 4} stroke={color} strokeOpacity={0.16} />
                        {chart.points.length === 1 ? (
                            <Circle cx={width / 2} cy={height / 2} r="3" fill={color} />
                        ) : (
                            <Path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                        )}
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
