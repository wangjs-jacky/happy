import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native-svg', () => ({ Circle: 'circle', G: 'g', Line: 'line', Rect: 'rect', Text: 'text' }));
import { FinanceChartAnnotations } from './FinanceChartAnnotations';
import type { FinanceChartAnnotation } from '@/utils/sessionFinanceCharts';

const annotations: FinanceChartAnnotation[] = [
    { type: 'region', from: 0, to: 2, label: 'Group' },
    { type: 'point', at: { index: 1, price: 12 }, label: 'Top' },
    { type: 'line', from: { index: 1, price: 12 }, to: { index: 3, price: 8 }, dashed: true, label: 'Candidate' },
];
const props = { annotations, count: 5, x: (i: number) => 30 + i * 69, y: (p: number) => 140 - p * 5, color: 'currentColor' };
describe('FinanceChartAnnotations', () => {
    it('uses candle coordinate transforms for endpoint and candidate line', () => {
        const html = renderToStaticMarkup(<FinanceChartAnnotations {...props} layer="marks" />);
        expect(html).toContain('cx="99" cy="80"');
        expect(html).toContain('x1="99" y1="80" x2="237" y2="100"');
        expect(html).toContain('stroke-dasharray="5 4"');
        expect(html).not.toContain('<rect');
        expect(html).toContain('>2</text>');
        expect(html).toContain('>3</text>');
    });
    it('clips inclusive region bands to the plot and keeps them behind marks', () => {
        const html = renderToStaticMarkup(<FinanceChartAnnotations {...props} layer="regions" />);
        expect(html).toContain('x="30" y="14" width="172.5"');
        expect(html).not.toContain('<circle');
        expect(html).toContain('>1</text>');
    });
});
