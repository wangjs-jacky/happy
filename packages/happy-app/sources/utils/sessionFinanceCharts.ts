import type { Message } from '@/sync/typesMessage';

const FINANCE_CHART_TAG = 'happy-finance-chart';
const BLOCK_REGEX = new RegExp(`<${FINANCE_CHART_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${FINANCE_CHART_TAG}>`, 'gi');

export type FinanceChartPoint = {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
};

export type FinanceChartAnchor = { index: number; price: number };
export type FinanceChartAnnotation =
    | { type: 'point'; at: FinanceChartAnchor; label: string }
    | { type: 'line'; from: FinanceChartAnchor; to: FinanceChartAnchor; label: string; dashed: boolean }
    | { type: 'region'; from: number; to: number; label: string };

// Invalid overlays are discarded independently; they must never break a market card.
function parseAnnotations(value: unknown, points: FinanceChartPoint[]): FinanceChartAnnotation[] {
    if (!Array.isArray(value)) return [];
    const index = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < points.length;
    const anchor = (v: unknown): FinanceChartAnchor | null => {
        const a = asRecord(v);
        if (!a || !index(a.index)) return null;
        const price = asNumber(a.price);
        const bar = points[a.index];
        return price !== null && price >= bar.low && price <= bar.high ? { index: a.index, price } : null;
    };
    return value.slice(0, 40).flatMap((v): FinanceChartAnnotation[] => {
        const a = asRecord(v);
        if (!a) return [];
        const label = (asString(a.label) ?? '').slice(0, 200);
        if (a.type === 'point') {
            const at = anchor(a.at);
            return at ? [{ type: 'point', at, label }] : [];
        }
        if (a.type === 'line') {
            const from = anchor(a.from), to = anchor(a.to);
            return from && to ? [{ type: 'line', from, to, label, dashed: a.dashed !== false }] : [];
        }
        if (a.type === 'region' && index(a.from) && index(a.to) && a.from <= a.to) {
            return [{ type: 'region', from: a.from, to: a.to, label }];
        }
        return [];
    });
}

export type SessionFinanceChart = {
    id: string;
    messageId: string;
    symbol: string;
    name: string;
    market: string | null;
    currency: string | null;
    range: string;
    interval: string;
    asOf: string;
    source: string;
    latest: {
        date: string;
        close: number;
        change: number | null;
        changePercent: number | null;
    };
    points: FinanceChartPoint[];
    annotations?: FinanceChartAnnotation[];
    numberedBars?: boolean;
    raw: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNullableNumber(value: unknown): number | null {
    return value === null ? null : asNumber(value);
}

function parsePoint(value: unknown): FinanceChartPoint | null {
    const item = asRecord(value);
    if (!item) return null;

    const date = asString(item.date);
    const open = asNumber(item.open);
    const high = asNumber(item.high);
    const low = asNumber(item.low);
    const close = asNumber(item.close);
    const volume = asNullableNumber(item.volume);

    if (!date || open === null || high === null || low === null || close === null) {
        return null;
    }

    return { date, open, high, low, close, volume };
}

export function parseFinanceChartSection(
    section: string,
    options?: {
        messageId?: string;
        index?: number;
    }
): SessionFinanceChart | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(section.trim());
    } catch {
        return null;
    }

    const root = asRecord(parsed);
    const latest = asRecord(root?.latest);
    const symbol = asString(root?.symbol);
    const name = asString(root?.name);
    const range = asString(root?.range);
    const interval = asString(root?.interval);
    const asOf = asString(root?.asOf);
    const source = asString(root?.source);
    const latestDate = asString(latest?.date);
    const latestClose = asNumber(latest?.close);
    const points = Array.isArray(root?.points)
        ? root.points.map(parsePoint).filter((item): item is FinanceChartPoint => item !== null)
        : [];

    if (!symbol || !name || !range || !interval || !asOf || !source || !latestDate || latestClose === null || points.length === 0) {
        return null;
    }

    return {
        id: `${options?.messageId ?? 'inline'}:finance-chart:${options?.index ?? 0}`,
        messageId: options?.messageId ?? 'inline',
        symbol,
        name,
        market: asString(root?.market),
        currency: asString(root?.currency),
        range,
        interval,
        asOf,
        source,
        latest: {
            date: latestDate,
            close: latestClose,
            change: asNullableNumber(latest?.change),
            changePercent: asNullableNumber(latest?.changePercent),
        },
        points,
        // Filtering malformed bars changes indexes, so suppress overlays in that case.
        annotations: points.length === (root?.points as unknown[]).length ? parseAnnotations(root?.annotations, points) : [],
        numberedBars: root?.numberedBars === true,
        raw: section.trim(),
    };
}

export function extractMessageFinanceCharts(message: Message): SessionFinanceChart[] {
    if (message.kind !== 'agent-text' || message.isThinking) {
        return [];
    }

    const charts: SessionFinanceChart[] = [];
    let match: RegExpExecArray | null;
    while ((match = BLOCK_REGEX.exec(message.text)) !== null) {
        const chart = parseFinanceChartSection(match[1], {
            messageId: message.id,
            index: charts.length,
        });
        if (chart) {
            charts.push(chart);
        }
    }
    return charts;
}

export function isHappyFinanceChartBlock(line: string): boolean {
    return line.trim().startsWith(`<${FINANCE_CHART_TAG}>`);
}

export function getFinanceChartCloseTag(): string {
    return `</${FINANCE_CHART_TAG}>`;
}
