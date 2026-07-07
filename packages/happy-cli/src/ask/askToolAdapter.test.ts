import { describe, expect, it, vi } from 'vitest';
import {
  buildAskToolContext,
  executeAskToolPlan,
  getAskToolRegistry,
  planAskTools,
} from './askToolAdapter';

describe('getAskToolRegistry', () => {
  it('exposes only ask-safe tools with explicit permissions', () => {
    expect(getAskToolRegistry().map((tool) => tool.name)).toEqual([
      'runtime_clock',
      'web_search',
    ]);
    expect(getAskToolRegistry().map((tool) => tool.permissions)).toEqual([
      { localFiles: false, shell: false, network: false },
      { localFiles: false, shell: false, network: true },
    ]);
  });
});

describe('planAskTools', () => {
  it('plans runtime only for deterministic date questions', () => {
    expect(planAskTools('今天星期几？')).toEqual([
      { toolName: 'runtime_clock', input: {} },
    ]);
  });

  it('plans focused web search for weather questions', () => {
    expect(planAskTools('深圳今天下雨吗？')).toEqual([
      { toolName: 'runtime_clock', input: {} },
      { toolName: 'web_search', input: { query: '深圳今天下雨吗？ weather current conditions', reason: 'weather' } },
    ]);
  });
});

describe('executeAskToolPlan', () => {
  it('runs planned tools and preserves successful and failed results', async () => {
    const fetchImpl = vi.fn(async () => new Response(`
      <a rel="nofollow" class="result__a" href="https://example.com/weather">Weather</a>
      <a class="result__snippet">Cloudy.</a>
    `));

    const results = await executeAskToolPlan(planAskTools('深圳今天下雨吗？'), {
      now: new Date('2026-07-06T00:00:00.000Z'),
      timeZone: 'UTC',
      fetchImpl,
    });

    expect(results.map((result) => result.toolName)).toEqual(['runtime_clock', 'web_search']);
    expect(results[0]).toMatchObject({ status: 'success' });
    expect(results[1]).toMatchObject({
      status: 'success',
      content: '1. Weather - https://example.com/weather\n   Cloudy.',
    });
  });

  it('turns tool failures into failed results instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const results = await executeAskToolPlan(planAskTools('搜索一下 DeepSeek 最新消息'), {
      fetchImpl,
    });

    expect(results.at(-1)).toMatchObject({
      toolName: 'web_search',
      status: 'error',
      error: 'network down',
    });
  });
});

describe('buildAskToolContext', () => {
  it('formats plan and results as model-readable context', async () => {
    const fetchImpl = vi.fn(async () => new Response(`
      <a rel="nofollow" class="result__a" href="https://example.com/news">Latest</a>
      <a class="result__snippet">Fresh context.</a>
    `));

    const context = await buildAskToolContext('搜索一下 DeepSeek 最新消息', {
      now: new Date('2026-07-06T00:00:00.000Z'),
      timeZone: 'UTC',
      fetchImpl,
    });

    expect(context).toContain('<context>');
    expect(context).toContain('Tool plan');
    expect(context).toContain('Executed tools: runtime_clock, web_search');
    expect(context).toContain('Runtime context');
    expect(context).toContain('Web search results');
    expect(context).toContain('Latest - https://example.com/news');
  });
});
