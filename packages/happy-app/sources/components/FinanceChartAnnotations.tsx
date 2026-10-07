import * as React from 'react';
import { Circle, G, Line, Rect, Text } from 'react-native-svg';
import type { FinanceChartAnnotation } from '@/utils/sessionFinanceCharts';
import { FINANCE_CHART_PADDING_LEFT as LEFT, FINANCE_CHART_PADDING_TOP as TOP, FINANCE_CHART_PLOT_HEIGHT as HEIGHT, FINANCE_CHART_PLOT_WIDTH as WIDTH } from '@/utils/financeChartInteraction';

/** Overlay positions use the same price/index transforms as the candles. */
export function FinanceChartAnnotations({ annotations, count, x, y, color, layer }: {
    annotations: FinanceChartAnnotation[];
    count: number;
    x: (index: number) => number;
    y: (price: number) => number;
    color: string;
    layer: 'regions' | 'marks';
}) {
    const halfStep = count > 1 ? WIDTH / (count - 1) / 2 : WIDTH / 2;
    const badge = (index: number, xx: number, yy: number) => (
        <Text x={Math.max(LEFT + 6, Math.min(LEFT + WIDTH - 6, xx))} y={Math.max(TOP + 10, Math.min(TOP + HEIGHT - 2, yy))} textAnchor="middle" fill={color} fontSize={10} fontWeight="bold">{index + 1}</Text>
    );
    return <G pointerEvents="none">
        {annotations.map((a, i) => {
            if ((a.type === 'region') !== (layer === 'regions')) return null;
            if (a.type === 'region') {
                const left = Math.max(LEFT, x(a.from) - halfStep);
                const right = Math.min(LEFT + WIDTH, x(a.to) + halfStep);
                return <G key={i}>
                    <Rect x={left} y={TOP} width={right - left} height={HEIGHT} fill={color} fillOpacity={0.08} stroke={color} strokeDasharray="3 3" />
                    {badge(i, (left + right) / 2, TOP + 10)}
                </G>;
            }
            if (a.type === 'point') return <G key={i}>
                <Circle cx={x(a.at.index)} cy={y(a.at.price)} r={5} fill="none" stroke={color} strokeWidth={1.5} />
                {badge(i, x(a.at.index), y(a.at.price) - 8)}
            </G>;
            return <G key={i}>
                <Line x1={x(a.from.index)} y1={y(a.from.price)} x2={x(a.to.index)} y2={y(a.to.price)} stroke={color} strokeWidth={2} strokeDasharray={a.dashed ? '5 4' : undefined} />
                {badge(i, (x(a.from.index) + x(a.to.index)) / 2, (y(a.from.price) + y(a.to.price)) / 2 - 6)}
            </G>;
        })}
    </G>;
}
