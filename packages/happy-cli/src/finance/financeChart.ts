/**
 * Finance chart data retrieval and normalization.
 *
 * The MCP layer uses this module to fetch market data once, normalize it into a
 * small stable payload, and hand the App a ready-to-render structured block.
 */

export type FinanceChartRange = '5d' | '1mo' | '3mo' | '6mo' | '1y';
export type FinanceChartInterval = '1d';

export type FinanceSymbol = {
    symbol: string;
    name: string;
    market: string | null;
    eastmoneySecid?: string;
};

export type FinanceChartPoint = {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
};

export type FinanceChartData = {
    symbol: string;
    name: string;
    market: string | null;
    currency: string | null;
    range: FinanceChartRange;
    interval: FinanceChartInterval;
    asOf: string;
    source: string;
    latest: {
        date: string;
        close: number;
        change: number | null;
        changePercent: number | null;
    };
    points: FinanceChartPoint[];
};

export type FinanceChartToolResult = FinanceChartData & {
    block: string;
};

type YahooChartMeta = {
    currency?: unknown;
    symbol?: unknown;
    shortName?: unknown;
    longName?: unknown;
    regularMarketTime?: unknown;
    regularMarketPrice?: unknown;
    previousClose?: unknown;
    chartPreviousClose?: unknown;
    exchangeName?: unknown;
};

type YahooChartQuote = {
    open?: unknown;
    high?: unknown;
    low?: unknown;
    close?: unknown;
    volume?: unknown;
};

type YahooChartResult = {
    meta?: YahooChartMeta;
    timestamp?: unknown;
    indicators?: {
        quote?: unknown;
    };
};

type YahooChartPayload = {
    chart?: {
        result?: unknown;
        error?: unknown;
    };
};

type EastmoneyKlinePayload = {
    rc?: unknown;
    data?: {
        code?: unknown;
        market?: unknown;
        name?: unknown;
        preKPrice?: unknown;
        klines?: unknown;
    } | null;
};

const SOURCE_NAME = 'Yahoo Finance';
const DEFAULT_RANGE: FinanceChartRange = '1mo';
const DEFAULT_INTERVAL: FinanceChartInterval = '1d';

const SYMBOL_ALIASES: Record<string, FinanceSymbol> = {
    '上证': { symbol: '000001.SS', name: '上证指数', market: 'Shanghai', eastmoneySecid: '1.000001' },
    '上证指数': { symbol: '000001.SS', name: '上证指数', market: 'Shanghai', eastmoneySecid: '1.000001' },
    '000001': { symbol: '000001.SS', name: '上证指数', market: 'Shanghai', eastmoneySecid: '1.000001' },
    '000001.SS': { symbol: '000001.SS', name: '上证指数', market: 'Shanghai', eastmoneySecid: '1.000001' },
    '沪深300': { symbol: '000300.SS', name: '沪深300', market: 'Shanghai', eastmoneySecid: '1.000300' },
    '300': { symbol: '000300.SS', name: '沪深300', market: 'Shanghai', eastmoneySecid: '1.000300' },
    '000300': { symbol: '000300.SS', name: '沪深300', market: 'Shanghai', eastmoneySecid: '1.000300' },
    '000300.SS': { symbol: '000300.SS', name: '沪深300', market: 'Shanghai', eastmoneySecid: '1.000300' },
    '纳指': { symbol: '^IXIC', name: '纳斯达克综合指数', market: 'Nasdaq' },
    '纳斯达克': { symbol: '^IXIC', name: '纳斯达克综合指数', market: 'Nasdaq' },
    'IXIC': { symbol: '^IXIC', name: '纳斯达克综合指数', market: 'Nasdaq' },
    '^IXIC': { symbol: '^IXIC', name: '纳斯达克综合指数', market: 'Nasdaq' },
    '标普500': { symbol: '^GSPC', name: '标普500', market: 'S&P Dow Jones Indices' },
    'SPX': { symbol: '^GSPC', name: '标普500', market: 'S&P Dow Jones Indices' },
    '^GSPC': { symbol: '^GSPC', name: '标普500', market: 'S&P Dow Jones Indices' },
    '道指': { symbol: '^DJI', name: '道琼斯工业平均指数', market: 'DJI' },
    'DJI': { symbol: '^DJI', name: '道琼斯工业平均指数', market: 'DJI' },
    '^DJI': { symbol: '^DJI', name: '道琼斯工业平均指数', market: 'DJI' },
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asNumberString(value: string | undefined): number | null {
    if (value === undefined || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function asNumberArray(value: unknown): number[] {
    return Array.isArray(value)
        ? value.map(asNumber).filter((item): item is number => item !== null)
        : [];
}

function toDateString(seconds: number): string {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function round(value: number, digits: number = 2): number {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeAliasKey(query: string): string {
    return query.trim().replace(/\s+/g, '').toUpperCase();
}

function quoteArrayAt(values: number[], index: number): number | null {
    return index < values.length ? values[index] : null;
}

function yyyymmdd(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}${month}${day}`;
}

function rangeStartDate(range: FinanceChartRange): string {
    const date = new Date();
    switch (range) {
        case '5d':
            date.setDate(date.getDate() - 12);
            break;
        case '1mo':
            date.setMonth(date.getMonth() - 1);
            date.setDate(date.getDate() - 7);
            break;
        case '3mo':
            date.setMonth(date.getMonth() - 3);
            break;
        case '6mo':
            date.setMonth(date.getMonth() - 6);
            break;
        case '1y':
            date.setFullYear(date.getFullYear() - 1);
            break;
    }
    return yyyymmdd(date);
}

function eastmoneySecidForSymbol(symbol: string): string | null {
    const normalized = symbol.toUpperCase();
    const explicit = normalized.match(/^(\d{6})\.(SS|SZ)$/);
    const code = explicit?.[1] ?? (normalized.match(/^\d{6}$/)?.[0] ?? null);
    const suffix = explicit?.[2] ?? null;
    if (!code) return null;

    if (suffix === 'SS' || code.startsWith('6')) return `1.${code}`;
    if (suffix === 'SZ' || code.startsWith('0') || code.startsWith('3')) return `0.${code}`;
    return null;
}

function getFirstChartResult(payload: YahooChartPayload): YahooChartResult {
    const error = payload.chart?.error;
    if (error) {
        const message = asRecord(error)?.description ?? asRecord(error)?.message ?? 'unknown chart error';
        throw new Error(`Finance data source returned an error: ${String(message)}`);
    }

    const results = payload.chart?.result;
    if (!Array.isArray(results) || results.length === 0) {
        throw new Error('Finance data source returned no chart result');
    }

    return results[0] as YahooChartResult;
}

function getQuote(result: YahooChartResult): YahooChartQuote {
    const quotes = result.indicators?.quote;
    if (!Array.isArray(quotes) || quotes.length === 0) {
        throw new Error('Finance data source returned no quote data');
    }
    return quotes[0] as YahooChartQuote;
}

export function resolveFinanceSymbol(query: string): FinanceSymbol {
    const raw = query.trim();
    if (!raw) {
        throw new Error('Finance query is required');
    }

    const key = normalizeAliasKey(raw);
    const alias = SYMBOL_ALIASES[key];
    if (alias) {
        return alias;
    }

    return {
        symbol: raw.toUpperCase(),
        name: raw.toUpperCase(),
        market: null,
        ...(eastmoneySecidForSymbol(raw) ? { eastmoneySecid: eastmoneySecidForSymbol(raw)! } : {}),
    };
}

export function normalizeYahooChartResult(input: {
    query: string;
    range?: FinanceChartRange;
    interval?: FinanceChartInterval;
    resolved: FinanceSymbol;
    payload: YahooChartPayload;
}): FinanceChartData {
    const range = input.range ?? DEFAULT_RANGE;
    const interval = input.interval ?? DEFAULT_INTERVAL;
    const result = getFirstChartResult(input.payload);
    const quote = getQuote(result);
    const meta = result.meta ?? {};
    const timestamps = asNumberArray(result.timestamp);
    const open = asNumberArray(quote.open);
    const high = asNumberArray(quote.high);
    const low = asNumberArray(quote.low);
    const close = asNumberArray(quote.close);
    const volume = asNumberArray(quote.volume);

    const points: FinanceChartPoint[] = timestamps.flatMap((timestamp, index) => {
        const openValue = quoteArrayAt(open, index);
        const highValue = quoteArrayAt(high, index);
        const lowValue = quoteArrayAt(low, index);
        const closeValue = quoteArrayAt(close, index);
        if (openValue === null || highValue === null || lowValue === null || closeValue === null) {
            return [];
        }
        return [{
            date: toDateString(timestamp),
            open: round(openValue),
            high: round(highValue),
            low: round(lowValue),
            close: round(closeValue),
            volume: quoteArrayAt(volume, index),
        }];
    });

    if (points.length === 0) {
        throw new Error('Finance data source returned no usable OHLC points');
    }

    const latest = points[points.length - 1];
    const previousClose = asNumber(meta.previousClose) ?? asNumber(meta.chartPreviousClose);
    const change = previousClose === null ? null : round(latest.close - previousClose);
    const changePercent = previousClose === null || previousClose === 0
        ? null
        : round((latest.close - previousClose) / previousClose * 100);
    const asOfSeconds = asNumber(meta.regularMarketTime) ?? timestamps[timestamps.length - 1];

    return {
        symbol: typeof meta.symbol === 'string' ? meta.symbol : input.resolved.symbol,
        name: input.resolved.name || (typeof meta.shortName === 'string' ? meta.shortName : input.resolved.symbol),
        market: input.resolved.market ?? (typeof meta.exchangeName === 'string' ? meta.exchangeName : null),
        currency: typeof meta.currency === 'string' ? meta.currency : null,
        range,
        interval,
        asOf: new Date(asOfSeconds * 1000).toISOString(),
        source: SOURCE_NAME,
        latest: {
            date: latest.date,
            close: latest.close,
            change,
            changePercent,
        },
        points,
    };
}

export function normalizeEastmoneyKlineResult(input: {
    range?: FinanceChartRange;
    interval?: FinanceChartInterval;
    resolved: FinanceSymbol;
    payload: EastmoneyKlinePayload;
}): FinanceChartData {
    if (input.payload.rc !== undefined && input.payload.rc !== 0) {
        throw new Error(`Eastmoney returned rc=${String(input.payload.rc)}`);
    }
    const data = input.payload.data;
    const klines = data?.klines;
    if (!data || !Array.isArray(klines) || klines.length === 0) {
        throw new Error('Eastmoney returned no kline data');
    }

    const points: FinanceChartPoint[] = klines.flatMap((line) => {
        if (typeof line !== 'string') return [];
        const [date, openRaw, closeRaw, highRaw, lowRaw, volumeRaw] = line.split(',');
        const open = asNumberString(openRaw);
        const close = asNumberString(closeRaw);
        const high = asNumberString(highRaw);
        const low = asNumberString(lowRaw);
        if (!date || open === null || close === null || high === null || low === null) {
            return [];
        }
        return [{
            date,
            open: round(open),
            high: round(high),
            low: round(low),
            close: round(close),
            volume: asNumberString(volumeRaw),
        }];
    });

    if (points.length === 0) {
        throw new Error('Eastmoney returned no usable OHLC points');
    }

    const latest = points[points.length - 1];
    const previousClose = points.length > 1
        ? points[points.length - 2].close
        : asNumber(data.preKPrice);
    const change = previousClose === null ? null : round(latest.close - previousClose);
    const changePercent = previousClose === null || previousClose === 0
        ? null
        : round((latest.close - previousClose) / previousClose * 100);

    return {
        symbol: input.resolved.symbol,
        name: typeof data.name === 'string' && data.name.trim().length > 0 ? data.name : input.resolved.name,
        market: input.resolved.market,
        currency: 'CNY',
        range: input.range ?? DEFAULT_RANGE,
        interval: input.interval ?? DEFAULT_INTERVAL,
        asOf: new Date(`${latest.date}T15:00:00+08:00`).toISOString(),
        source: 'Eastmoney',
        latest: {
            date: latest.date,
            close: latest.close,
            change,
            changePercent,
        },
        points,
    };
}

export function buildFinanceChartBlock(data: FinanceChartData): string {
    return [
        '<happy-finance-chart>',
        JSON.stringify(data, null, 2),
        '</happy-finance-chart>',
    ].join('\n');
}

export async function fetchFinanceChart(input: {
    query: string;
    range?: FinanceChartRange;
    interval?: FinanceChartInterval;
}): Promise<FinanceChartToolResult> {
    const range = input.range ?? DEFAULT_RANGE;
    const interval = input.interval ?? DEFAULT_INTERVAL;
    const resolved = resolveFinanceSymbol(input.query);
    if (resolved.eastmoneySecid) {
        try {
            const eastmoneyUrl = new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');
            eastmoneyUrl.searchParams.set('secid', resolved.eastmoneySecid);
            eastmoneyUrl.searchParams.set('fields1', 'f1,f2,f3,f4,f5,f6');
            eastmoneyUrl.searchParams.set('fields2', 'f51,f52,f53,f54,f55,f56,f57,f58');
            eastmoneyUrl.searchParams.set('klt', '101');
            eastmoneyUrl.searchParams.set('fqt', '1');
            eastmoneyUrl.searchParams.set('beg', rangeStartDate(range));
            eastmoneyUrl.searchParams.set('end', yyyymmdd(new Date()));
            const eastmoneyResponse = await fetch(eastmoneyUrl, {
                headers: {
                    accept: 'application/json',
                    'user-agent': 'Mozilla/5.0 Happy Finance Chart/1.0',
                },
            });
            if (!eastmoneyResponse.ok) {
                throw new Error(`Eastmoney request failed with HTTP ${eastmoneyResponse.status}`);
            }
            const eastmoneyPayload = await eastmoneyResponse.json() as EastmoneyKlinePayload;
            const eastmoneyData = normalizeEastmoneyKlineResult({
                range,
                interval,
                resolved,
                payload: eastmoneyPayload,
            });
            return {
                ...eastmoneyData,
                block: buildFinanceChartBlock(eastmoneyData),
            };
        } catch (error) {
            if (resolved.symbol.endsWith('.SS') || resolved.symbol.endsWith('.SZ')) {
                throw error;
            }
        }
    }

    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(resolved.symbol)}`);
    url.searchParams.set('range', range);
    url.searchParams.set('interval', interval);

    const response = await fetch(url, {
        headers: {
            accept: 'application/json',
            'user-agent': 'Happy Finance Chart/1.0',
        },
    });
    if (!response.ok) {
        throw new Error(`Finance data source request failed with HTTP ${response.status}`);
    }

    const payload = await response.json() as YahooChartPayload;
    const data = normalizeYahooChartResult({
        query: input.query,
        range,
        interval,
        resolved,
        payload,
    });

    return {
        ...data,
        block: buildFinanceChartBlock(data),
    };
}
