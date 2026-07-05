import { describe, expect, it } from 'vitest';

import { pickFinanceChartPointIndex } from './financeChartInteraction';

describe('financeChartInteraction', () => {
    it('maps chart touch positions to the nearest data point index', () => {
        expect(pickFinanceChartPointIndex({ locationX: 30, layoutWidth: 320, pointCount: 5 })).toBe(0);
        expect(pickFinanceChartPointIndex({ locationX: 160, layoutWidth: 320, pointCount: 5 })).toBe(2);
        expect(pickFinanceChartPointIndex({ locationX: 306, layoutWidth: 320, pointCount: 5 })).toBe(4);
    });

    it('clamps out-of-range chart touch positions', () => {
        expect(pickFinanceChartPointIndex({ locationX: -200, layoutWidth: 320, pointCount: 5 })).toBe(0);
        expect(pickFinanceChartPointIndex({ locationX: 800, layoutWidth: 320, pointCount: 5 })).toBe(4);
        expect(pickFinanceChartPointIndex({ locationX: 800, layoutWidth: 0, pointCount: 5 })).toBe(0);
        expect(pickFinanceChartPointIndex({ locationX: 800, layoutWidth: 320, pointCount: 1 })).toBe(0);
    });
});
