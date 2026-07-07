import { ProxyAgent, type Dispatcher } from 'undici';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type AskWebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type RequestInitWithDispatcher = RequestInit & { dispatcher?: Dispatcher };

export type AskToolPlan = {
  runtime: true;
  webSearch: boolean;
  webQuery: string | null;
  reasons: string[];
};

export type AskToolContextOptions = {
  now?: Date;
  timeZone?: string;
  fetchImpl?: FetchLike;
  maxWebResults?: number;
  webTimeoutMs?: number;
  tavilyApiKey?: string | null;
};

const DEFAULT_WEB_TIMEOUT_MS = 6_000;
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const DEFAULT_TAVILY_CONFIG_PATH = join(
  homedir(),
  'jacky-github/jacky-skills/plugins/dev-tools/web-search/config.local.json',
);
const proxyAgents = new Map<string, ProxyAgent>();
const FRESH_INFORMATION_PATTERN = /(?:latest|current|recent|news|weather|price|stock|search|web|internet|browse|lookup|breaking|最新|实时|新闻|天气|股价|搜索|查一下|联网|网页|近况|最近|下雨|降雨|气温|温度|汇率|价格|行情|多少)/i;
const WEATHER_PATTERN = /(?:weather|temperature|rain|snow|forecast|天气|下雨|降雨|气温|温度|预报)/i;
const FINANCE_PATTERN = /(?:stock|share price|market cap|crypto|bitcoin|btc|price|股价|股票|行情|币价|比特币|汇率)/i;
const RUNTIME_ONLY_PATTERN = /(?:星期几|礼拜几|周几|几号|日期|几点|时间|today.*day|what day is it|current time)/i;

export function getLocalTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatAskRuntimeContext(now = new Date(), timeZone = getLocalTimeZone()): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(now);
  return [
    `Current date/time: ${formatted}`,
    `ISO time: ${now.toISOString()}`,
    `Weekday: ${weekday}`,
    `Time zone: ${timeZone}`,
  ].join('\n');
}

export function shouldUseWebSearch(text: string): boolean {
  if (RUNTIME_ONLY_PATTERN.test(text)) {
    return false;
  }
  return FRESH_INFORMATION_PATTERN.test(text);
}

export function resolveAskToolPlan(text: string): AskToolPlan {
  const reasons = ['runtime_clock'];
  const webSearch = shouldUseWebSearch(text);
  if (!webSearch) {
    return {
      runtime: true,
      webSearch: false,
      webQuery: null,
      reasons,
    };
  }

  reasons.push('web_search');
  let webQuery = text;
  if (WEATHER_PATTERN.test(text)) {
    reasons.push('weather');
    webQuery = `${text} weather current conditions`;
  } else if (FINANCE_PATTERN.test(text)) {
    reasons.push('finance');
    webQuery = `${text} market price latest`;
  }

  return {
    runtime: true,
    webSearch: true,
    webQuery,
    reasons,
  };
}

export function parseDuckDuckGoHtml(html: string, maxResults = 3): AskWebSearchResult[] {
  const results: AskWebSearchResult[] = [];
  const linkPattern = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) && results.length < maxResults) {
    const afterLink = html.slice(linkPattern.lastIndex, linkPattern.lastIndex + 1_500);
    const snippetMatch = /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(afterLink)
      ?? /class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(afterLink);
    const title = cleanHtml(match[2] ?? '');
    const url = normalizeDuckDuckGoUrl(decodeHtmlEntities(match[1] ?? ''));
    const snippet = snippetMatch ? cleanHtml(snippetMatch[1] ?? '') : '';
    if (title && url) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

export function resolveAskWebProxyUrl(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | null {
  return env.HAPPY_ASK_WEB_PROXY_URL
    || env.HAPPY_WEB_PROXY_URL
    || env.HTTPS_PROXY
    || env.https_proxy
    || env.HTTP_PROXY
    || env.http_proxy
    || env.ALL_PROXY
    || env.all_proxy
    || null;
}

export function resolveTavilyApiKey(options: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  configPath?: string;
  readFile?: (path: string) => string;
} = {}): string | null {
  const env = options.env ?? process.env;
  const envKey = env.HAPPY_ASK_TAVILY_API_KEY || env.TAVILY_API_KEY;
  if (envKey?.trim()) {
    return envKey.trim();
  }

  try {
    const raw = (options.readFile ?? ((path) => readFileSync(path, 'utf8')))(
      options.configPath ?? DEFAULT_TAVILY_CONFIG_PATH,
    );
    const parsed = JSON.parse(raw) as { tavily?: { apiKey?: unknown; enabled?: unknown } };
    if (parsed.tavily?.enabled === false) {
      return null;
    }
    return typeof parsed.tavily?.apiKey === 'string' && parsed.tavily.apiKey.trim()
      ? parsed.tavily.apiKey.trim()
      : null;
  } catch {
    return null;
  }
}

export async function searchWeb(query: string, options: AskToolContextOptions = {}): Promise<AskWebSearchResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tavilyApiKey = options.tavilyApiKey ?? (options.fetchImpl ? null : resolveTavilyApiKey());
  if (tavilyApiKey) {
    try {
      const tavilyResults = await searchTavily(query, tavilyApiKey, options);
      if (tavilyResults.length > 0) {
        return tavilyResults;
      }
    } catch {
      // Fall back to DuckDuckGo. The adapter suppresses failed search details from the model context.
    }
  }

  const init = buildWebSearchRequestInit(options);
  const response = await fetchImpl(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, init);
  if (!response.ok) {
    return [];
  }
  return parseDuckDuckGoHtml(await response.text(), options.maxWebResults ?? 3);
}

async function searchTavily(
  query: string,
  apiKey: string,
  options: AskToolContextOptions,
): Promise<AskWebSearchResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(TAVILY_SEARCH_URL, buildTavilyRequestInit(query, apiKey, options));
  if (!response.ok) {
    return [];
  }
  const payload = await response.json() as {
    answer?: unknown;
    results?: Array<{
      title?: unknown;
      url?: unknown;
      content?: unknown;
      raw_content?: unknown;
    }>;
  };
  const results: AskWebSearchResult[] = [];
  if (typeof payload.answer === 'string' && payload.answer.trim()) {
    results.push({
      title: 'Tavily answer',
      url: TAVILY_SEARCH_URL,
      snippet: payload.answer.trim(),
    });
  }
  for (const item of payload.results ?? []) {
    if (results.length >= (options.maxWebResults ?? 3)) {
      break;
    }
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const snippet = typeof item.content === 'string' && item.content.trim()
      ? item.content.trim()
      : typeof item.raw_content === 'string' ? item.raw_content.trim() : '';
    if (title && url) {
      results.push({ title, url, snippet });
    }
  }
  return results;
}

function buildTavilyRequestInit(
  query: string,
  apiKey: string,
  options: AskToolContextOptions,
): RequestInitWithDispatcher {
  const init: RequestInitWithDispatcher = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: options.maxWebResults ?? 3,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(options.webTimeoutMs ?? DEFAULT_WEB_TIMEOUT_MS),
  };
  attachProxyDispatcher(init, options);
  return init;
}

function buildWebSearchRequestInit(options: AskToolContextOptions): RequestInitWithDispatcher {
  const init: RequestInitWithDispatcher = {
    headers: {
      accept: 'text/html',
      'user-agent': 'HappyAsk/1.0',
    },
    signal: AbortSignal.timeout(options.webTimeoutMs ?? DEFAULT_WEB_TIMEOUT_MS),
  };
  attachProxyDispatcher(init, options);
  return init;
}

function attachProxyDispatcher(init: RequestInitWithDispatcher, options: AskToolContextOptions): void {
  if (!options.fetchImpl) {
    const proxyUrl = resolveAskWebProxyUrl();
    if (proxyUrl) {
      init.dispatcher = getProxyAgent(proxyUrl);
    }
  }
}

function getProxyAgent(proxyUrl: string): ProxyAgent {
  const cached = proxyAgents.get(proxyUrl);
  if (cached) {
    return cached;
  }
  const agent = new ProxyAgent(proxyUrl);
  proxyAgents.set(proxyUrl, agent);
  return agent;
}

export async function buildAskAugmentedUserContent(
  userText: string,
  options: AskToolContextOptions = {},
): Promise<string> {
  const { buildAskToolContext } = await import('./askToolAdapter');
  return `${await buildAskToolContext(userText, options)}\n\nUser question:\n${userText}`;
}

function cleanHtml(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

function normalizeDuckDuckGoUrl(rawUrl: string): string {
  const withProtocol = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  try {
    const parsed = new URL(withProtocol);
    const redirected = parsed.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : parsed.toString();
  } catch {
    return withProtocol;
  }
}
