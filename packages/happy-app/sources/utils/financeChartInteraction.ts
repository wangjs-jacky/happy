export const FINANCE_CHART_WIDTH = 320;
export const FINANCE_CHART_HEIGHT = 170;
export const FINANCE_CHART_PADDING_LEFT = 30;
export const FINANCE_CHART_PADDING_RIGHT = 14;
export const FINANCE_CHART_PADDING_TOP = 14;
export const FINANCE_CHART_PADDING_BOTTOM = 28;
export const FINANCE_CHART_PLOT_WIDTH = FINANCE_CHART_WIDTH - FINANCE_CHART_PADDING_LEFT - FINANCE_CHART_PADDING_RIGHT;
export const FINANCE_CHART_PLOT_HEIGHT = FINANCE_CHART_HEIGHT - FINANCE_CHART_PADDING_TOP - FINANCE_CHART_PADDING_BOTTOM;

export function pickFinanceChartPointIndex(input: {
    locationX: number;
    layoutWidth: number;
    pointCount: number;
}): number {
    if (input.pointCount <= 1 || input.layoutWidth <= 0) return 0;

    const viewBoxX = input.locationX / input.layoutWidth * FINANCE_CHART_WIDTH;
    const ratio = (viewBoxX - FINANCE_CHART_PADDING_LEFT) / FINANCE_CHART_PLOT_WIDTH;
    return Math.max(0, Math.min(input.pointCount - 1, Math.round(ratio * (input.pointCount - 1))));
}
