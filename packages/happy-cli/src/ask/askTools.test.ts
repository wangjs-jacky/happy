import { describe, expect, it, vi } from 'vitest';
import {
  buildAskAugmentedUserContent,
  formatAskRuntimeContext,
  parseDuckDuckGoHtml,
  shouldUseWebSearch,
} from './askTools';

describe('formatAskRuntimeContext', () => {
  it('includes deterministic local date and weekday context', () => {
    expect(formatAskRuntimeContext(new Date('2026-07-06T00:00:00.000Z'), 'UTC')).toContain(
      'Monday, July 6, 2026',
    );
  });
});

describe('shouldUseWebSearch', () => {
  it('uses runtime context for date questions without web search', () => {
    expect(shouldUseWebSearch('今天是星期几？')).toBe(false);
  });

  it('enables web search for fresh information requests', () => {
    expect(shouldUseWebSearch('搜索一下 DeepSeek 最新消息')).toBe(true);
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
    expect(content).toContain('Web search results');
    expect(content).toContain('Latest - https://example.com/news');
    expect(content).toContain('User question:\n搜索一下 DeepSeek 最新消息');
  });
});
