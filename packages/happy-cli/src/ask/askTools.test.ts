import { describe, expect, it, vi } from 'vitest';
import {
  buildAskAugmentedUserContent,
  formatAskRuntimeContext,
  parseDuckDuckGoHtml,
  resolveAskWebProxyUrl,
  resolveTavilyApiKey,
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

  it('omits failed web search details but still provides runtime context', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });

    const content = await buildAskAugmentedUserContent('搜索一下 DeepSeek 最新消息', {
      now: new Date('2026-07-06T00:00:00.000Z'),
      timeZone: 'UTC',
      fetchImpl,
    });

    expect(content).toContain('Runtime context');
    expect(content).not.toContain('Web search unavailable');
    expect(content).not.toContain('network down');
    expect(content).not.toContain('web_search');
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

  it('uses Tavily before DuckDuckGo when a Tavily key is configured', async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.tavily.com/search');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        api_key: 'tvly-test',
        query: 'world cup latest',
        max_results: 3,
        include_answer: true,
      });
      return Response.json({
        answer: 'Latest World Cup summary.',
        results: [
          { title: 'FIFA update', url: 'https://example.com/fifa', content: 'Tournament details.' },
        ],
      });
    });

    await expect(searchWeb('world cup latest', {
      fetchImpl,
      tavilyApiKey: 'tvly-test',
    })).resolves.toEqual([
      {
        title: 'Tavily answer',
        url: 'https://api.tavily.com/search',
        snippet: 'Latest World Cup summary.',
      },
      {
        title: 'FIFA update',
        url: 'https://example.com/fifa',
        snippet: 'Tournament details.',
      },
    ]);
  });

  it('falls back to DuckDuckGo when Tavily fails', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === 'https://api.tavily.com/search') {
        throw new Error('tavily down');
      }
      return new Response(`
        <a rel="nofollow" class="result__a" href="https://example.com/news">Fallback</a>
        <a class="result__snippet">DuckDuckGo result.</a>
      `);
    });

    await expect(searchWeb('world cup latest', {
      fetchImpl,
      tavilyApiKey: 'tvly-test',
    })).resolves.toEqual([
      {
        title: 'Fallback',
        url: 'https://example.com/news',
        snippet: 'DuckDuckGo result.',
      },
    ]);
  });
});

describe('resolveAskWebProxyUrl', () => {
  it('prefers explicit Ask web proxy over inherited proxies', () => {
    expect(resolveAskWebProxyUrl({
      HAPPY_ASK_WEB_PROXY_URL: 'http://127.0.0.1:10802',
      HTTPS_PROXY: 'http://127.0.0.1:9999',
    })).toBe('http://127.0.0.1:10802');
  });

  it('uses HTTPS proxy environment for web search fallback', () => {
    expect(resolveAskWebProxyUrl({
      HTTPS_PROXY: 'http://127.0.0.1:10802',
    })).toBe('http://127.0.0.1:10802');
  });
});

describe('resolveTavilyApiKey', () => {
  it('prefers environment variables over local skill config', () => {
    expect(resolveTavilyApiKey({
      env: { TAVILY_API_KEY: 'tvly-env' },
      readFile: () => '{"tavily":{"apiKey":"tvly-local"}}',
    })).toBe('tvly-env');
  });

  it('reads the web-search skill local config when no environment key is set', () => {
    expect(resolveTavilyApiKey({
      env: {},
      configPath: '/tmp/config.local.json',
      readFile: () => '{"tavily":{"apiKey":"tvly-local","enabled":true}}',
    })).toBe('tvly-local');
  });
});
