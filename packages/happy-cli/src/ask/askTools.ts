export type AskWebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

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
};

const DEFAULT_WEB_TIMEOUT_MS = 6_000;
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

export async function searchWeb(query: string, options: AskToolContextOptions = {}): Promise<AskWebSearchResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      accept: 'text/html',
      'user-agent': 'HappyAsk/1.0',
    },
    signal: AbortSignal.timeout(options.webTimeoutMs ?? DEFAULT_WEB_TIMEOUT_MS),
  });
  if (!response.ok) {
    return [];
  }
  return parseDuckDuckGoHtml(await response.text(), options.maxWebResults ?? 3);
}

export async function buildAskAugmentedUserContent(
  userText: string,
  options: AskToolContextOptions = {},
): Promise<string> {
  const timeZone = options.timeZone ?? getLocalTimeZone();
  const plan = resolveAskToolPlan(userText);
  const sections = [
    `Tool plan:\nExecuted tools: ${plan.reasons.join(', ')}${plan.webQuery ? `\nWeb query: ${plan.webQuery}` : ''}`,
    `Runtime context:\n${formatAskRuntimeContext(options.now ?? new Date(), timeZone)}`,
  ];

  if (plan.webSearch && plan.webQuery) {
    try {
      const results = await searchWeb(plan.webQuery, options);
      if (results.length > 0) {
        sections.push(`Web search results:\n${formatWebResults(results)}`);
      }
    } catch (error) {
      sections.push(`Web search unavailable:\n${formatUnknownError(error)}`);
    }
  }

  return `${sections.map((section) => `<context>\n${section}\n</context>`).join('\n\n')}\n\nUser question:\n${userText}`;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatWebResults(results: AskWebSearchResult[]): string {
  return results
    .map((result, index) => `${index + 1}. ${result.title} - ${result.url}${result.snippet ? `\n   ${result.snippet}` : ''}`)
    .join('\n');
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
