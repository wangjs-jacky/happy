import { describe, expect, it, vi } from 'vitest';
import {
  buildAskAugmentedUserContent,
  formatAskRuntimeContext,
  parseDuckDuckGoHtml,
  resolveAskToolPlan,
  searchWeb,
  shouldUseWebSearch,
} from './askTools';

describe('formatAskRuntimeContext', () => {
  it('includes deterministic local date and weekday context', () => {
    const context = formatAskRuntimeContext(new Date('2026-07-06T00:00:00.000Z'), 'UTC');
    expect(context).toContain('Monday, July 6, 2026');
    expect(context).toContain('ISO time: 2026-07-06T00:00:00.000Z');
    expect(context).toContain('Weekday: Monday');
  });
});

describe('shouldUseWebSearch', () => {
  it('uses runtime context for date questions without web search', () => {
    expect(shouldUseWebSearch('今天是星期几？')).toBe(false);
  });

  it('enables web search for fresh information requests', () => {
    expect(shouldUseWebSearch('搜索一下 DeepSeek 最新消息')).toBe(true);
  });

  it('enables web search for weather and finance requests', () => {
    expect(shouldUseWebSearch('深圳今天下雨吗？')).toBe(true);
    expect(shouldUseWebSearch('特斯拉现在股价是多少？')).toBe(true);
  });
});

describe('resolveAskToolPlan', () => {
  it('describes executed tools and focused web queries', () => {
    expect(resolveAskToolPlan('深圳今天下雨吗？')).toEqual({
      runtime: true,
      webSearch: true,
      webQuery: '深圳今天下雨吗？ weather current conditions',
      reasons: ['runtime_clock', 'web_search', 'weather'],
    });
    expect(resolveAskToolPlan('今天星期几？')).toEqual({
      runtime: true,
      webSearch: false,
      webQuery: null,
      reasons: ['runtime_clock'],
    });
  });
});

describe('parseDuckDuckGoHtml', () => {
  it('extracts result title, url, and snippet from DuckDuckGo html', () => {
    const html = `
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdeepseek">DeepSeek News</a>
      <a class="result__snippet">A concise result snippet.</a>
    `;

    expect(parseDuckDuckGoHtml(html)).toEqual([
      {
        title: 'DeepSeek News',
        url: 'https://example.com/deepseek',
        snippet: 'A concise result snippet.',
      },
    ]);
  });
});

describe('buildAskAugmentedUserContent', () => {
  it('adds runtime and web result context without changing the visible user question', async () => {
    const fetchImpl = vi.fn(async () => new Response(`
      <a rel="nofollow" class="result__a" href="https://example.com/news">Latest</a>
      <a class="result__snippet">Fresh context.</a>
    `));

    const content = await buildAskAugmentedUserContent('搜索一下 DeepSeek 最新消息', {
      now: new Date('2026-07-06T00:00:00.000Z'),
      timeZone: 'UTC',
      fetchImpl,
    });

    expect(content).toContain('Runtime context');
    expect(content).toContain('Monday, July 6, 2026');
    expect(content).toContain('Tool plan');
    expect(content).toContain('Executed tools: runtime_clock, web_search');
    expect(content).toContain('Web search results');
    expect(content).toContain('Latest - https://example.com/news');
    expect(content).toContain('User question:\n搜索一下 DeepSeek 最新消息');
  });

  it('reports web search failure but still provides runtime context', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const content = await buildAskAugmentedUserContent('搜索一下 DeepSeek 最新消息', {
      now: new Date('2026-07-06T00:00:00.000Z'),
      timeZone: 'UTC',
      fetchImpl,
    });

    expect(content).toContain('Runtime context');
    expect(content).toContain('Web search unavailable');
    expect(content).toContain('network down');
    expect(content).toContain('User question:\n搜索一下 DeepSeek 最新消息');
  });
});

describe('searchWeb', () => {
  it('applies a timeout signal to web search requests', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('');
    });

    await searchWeb('latest news', { fetchImpl, webTimeoutMs: 1234 });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
