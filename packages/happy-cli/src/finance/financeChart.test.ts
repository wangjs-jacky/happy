import { describe, expect, it } from 'vitest';

import {
    buildFinanceChartBlock,
    normalizeEastmoneyKlineResult,
    normalizeYahooChartResult,
    resolveFinanceSymbol,
} from './financeChart';

const yahooFixture = {
    chart: {
        result: [
            {
                meta: {
                    currency: 'CNY',
                    symbol: '000001.SS',
                    shortName: 'SSE Composite Index',
                    regularMarketTime: 1783094400,
                    regularMarketPrice: 4043.64,
                    previousClose: 4028.90,
                    exchangeName: 'Shanghai',
                },
                timestamp: [1782921600, 1783008000, 1783094400],
                indicators: {
                    quote: [
                        {
                            open: [4089.12, 4028.21, 4031.33],
                            high: [4142.77, 4094.44, 4073.88],
                            low: [4058.31, 4018.22, 4027.25],
                            close: [4110.42, 4028.90, 4043.64],
                            volume: [423400, 397100, 601100],
                        },
                    ],
                },
            },
        ],
        error: null,
    },
};

const eastmoneyFixture = {
    rc: 0,
    data: {
        code: '000001',
        market: 1,
        name: '上证指数',
        preKPrice: 4028.90,
        klines: [
            '2026-07-01,4089.12,4110.42,4142.77,4058.31,423400,1319801913950.90,1.16',
            '2026-07-02,4028.21,4028.90,4094.44,4018.22,397100,1280966176160.90,1.40',
            '2026-07-03,4031.33,4043.64,4073.88,4027.25,601100,1429755844607.80,1.16',
        ],
    },
};

describe('financeChart', () => {
    it('resolves common Chinese index aliases to provider symbols', () => {
        expect(resolveFinanceSymbol('上证指数')).toMatchObject({
            symbol: '000001.SS',
            name: '上证指数',
        });
        expect(resolveFinanceSymbol('纳指')).toMatchObject({
            symbol: '^IXIC',
            name: '纳斯达克综合指数',
        });
        expect(resolveFinanceSymbol('AAPL')).toMatchObject({
            symbol: 'AAPL',
            name: 'AAPL',
        });
    });

    it('normalizes Yahoo chart payload into Happy finance chart data', () => {
        const data = normalizeYahooChartResult({
            query: '上证指数',
            range: '1mo',
            interval: '1d',
            resolved: resolveFinanceSymbol('上证指数'),
            payload: yahooFixture,
        });

        expect(data).toMatchObject({
            symbol: '000001.SS',
            name: '上证指数',
            market: 'Shanghai',
            currency: 'CNY',
            range: '1mo',
            interval: '1d',
            source: 'Yahoo Finance',
            latest: {
                date: '2026-07-03',
                close: 4043.64,
                change: 14.74,
                changePercent: 0.37,
            },
        });
        expect(data.points).toHaveLength(3);
        expect(data.points[2]).toEqual({
            date: '2026-07-03',
            open: 4031.33,
            high: 4073.88,
            low: 4027.25,
            close: 4043.64,
            volume: 601100,
        });
    });

    it('normalizes Eastmoney kline payload into Happy finance chart data', () => {
        const data = normalizeEastmoneyKlineResult({
            range: '1mo',
            interval: '1d',
            resolved: resolveFinanceSymbol('上证指数'),
            payload: eastmoneyFixture,
        });

        expect(data).toMatchObject({
            symbol: '000001.SS',
            name: '上证指数',
            market: 'Shanghai',
            currency: 'CNY',
            source: 'Eastmoney',
            latest: {
                date: '2026-07-03',
                close: 4043.64,
                change: 14.74,
                changePercent: 0.37,
            },
        });
        expect(data.points[0]).toEqual({
            date: '2026-07-01',
            open: 4089.12,
            close: 4110.42,
            high: 4142.77,
            low: 4058.31,
            volume: 423400,
        });
    });

    it('serializes normalized data into a happy finance chart block', () => {
        const data = normalizeYahooChartResult({
            query: '上证指数',
            range: '1mo',
            interval: '1d',
            resolved: resolveFinanceSymbol('上证指数'),
            payload: yahooFixture,
        });

        const block = buildFinanceChartBlock(data);

        expect(block).toContain('<happy-finance-chart>');
        expect(block).toContain('"symbol": "000001.SS"');
        expect(block).toContain('"close": 4043.64');
        expect(block).toContain('</happy-finance-chart>');
    });
});
