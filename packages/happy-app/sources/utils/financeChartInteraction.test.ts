import { describe, expect, it } from 'vitest';

import { arbitrateFinanceChartGesture, pickFinanceChartPointIndex } from './financeChartInteraction';

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

    it('keeps tiny movements undecided before claiming a chart gesture', () => {
        expect(arbitrateFinanceChartGesture({ dx: 3, dy: 2 })).toBe('undecided');
        expect(arbitrateFinanceChartGesture({ dx: -2, dy: 4 })).toBe('undecided');
    });

    it('yields vertical drags to the parent scroll container', () => {
        expect(arbitrateFinanceChartGesture({ dx: 5, dy: 14 })).toBe('parent');
        expect(arbitrateFinanceChartGesture({ dx: -7, dy: -18 })).toBe('parent');
    });

    it('claims horizontal drags in either direction for chart scrubbing', () => {
        expect(arbitrateFinanceChartGesture({ dx: 12, dy: 3 })).toBe('chart');
        expect(arbitrateFinanceChartGesture({ dx: -12, dy: 3 })).toBe('chart');
    });
});
