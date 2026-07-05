import { describe, expect, it } from 'vitest';

import {
    extractMessageFinanceCharts,
    parseFinanceChartSection,
} from './sessionFinanceCharts';
import type { AgentTextMessage } from '@/sync/typesMessage';

function agentMessage(text: string, id: string = 'msg-1'): AgentTextMessage {
    return {
        kind: 'agent-text',
        id,
        localId: null,
        createdAt: Date.now(),
        text,
    };
}

const financeJson = JSON.stringify({
    symbol: '000001.SS',
    name: '上证指数',
    market: 'Shanghai',
    currency: 'CNY',
    range: '1mo',
    interval: '1d',
    asOf: '2026-07-03T16:00:00.000Z',
    source: 'Yahoo Finance',
    latest: {
        date: '2026-07-03',
        close: 4043.64,
        change: 14.74,
        changePercent: 0.37,
    },
    points: [
        { date: '2026-07-01', open: 4089.12, high: 4142.77, low: 4058.31, close: 4110.42, volume: 423400 },
        { date: '2026-07-02', open: 4028.21, high: 4094.44, low: 4018.22, close: 4028.90, volume: 397100 },
        { date: '2026-07-03', open: 4031.33, high: 4073.88, low: 4027.25, close: 4043.64, volume: 601100 },
    ],
}, null, 2);

describe('sessionFinanceCharts', () => {
    it('parses a valid finance chart JSON section', () => {
        const chart = parseFinanceChartSection(financeJson);

        expect(chart).toMatchObject({
            symbol: '000001.SS',
            name: '上证指数',
            source: 'Yahoo Finance',
            latest: {
                close: 4043.64,
                changePercent: 0.37,
            },
        });
        expect(chart?.points).toHaveLength(3);
    });

    it('rejects invalid JSON and payloads without enough points', () => {
        expect(parseFinanceChartSection('{ bad json')).toBeNull();
        expect(parseFinanceChartSection(JSON.stringify({
            symbol: 'AAPL',
            name: 'AAPL',
            range: '1mo',
            interval: '1d',
            asOf: '2026-07-03T16:00:00.000Z',
            source: 'Yahoo Finance',
            latest: { date: '2026-07-03', close: 1, change: null, changePercent: null },
            points: [],
        }))).toBeNull();
    });

    it('extracts tagged finance chart blocks from agent text', () => {
        const charts = extractMessageFinanceCharts(agentMessage(`
            Here is the chart.

            <happy-finance-chart>
            ${financeJson}
            </happy-finance-chart>
        `));

        expect(charts).toHaveLength(1);
        expect(charts[0].id).toBe('msg-1:finance-chart:0');
        expect(charts[0].symbol).toBe('000001.SS');
    });
});
