import {
  formatAskRuntimeContext,
  parseDuckDuckGoHtml,
  resolveAskToolPlan,
  searchWeb,
  type AskToolContextOptions,
} from './askTools';

export type AskToolPermissions = {
  localFiles: false;
  shell: false;
  network: boolean;
};

export type AskToolCall = {
  toolName: string;
  input: Record<string, unknown>;
};

export type AskToolResult = {
  toolName: string;
  status: 'success' | 'error';
  content?: string;
  error?: string;
};

export type AskTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissions: AskToolPermissions;
  execute(input: Record<string, unknown>, options: AskToolContextOptions): Promise<string>;
};

const runtimeClockTool: AskTool = {
  name: 'runtime_clock',
  description: 'Returns the current date, time, weekday, and timezone for Ask mode.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  permissions: { localFiles: false, shell: false, network: false },
  async execute(_input, options) {
    return formatAskRuntimeContext(options.now ?? new Date(), options.timeZone);
  },
};

const webSearchTool: AskTool = {
  name: 'web_search',
  description: 'Searches the public web and returns compact title, URL, and snippet results.',
  inputSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      reason: { type: 'string' },
    },
    additionalProperties: false,
  },
  permissions: { localFiles: false, shell: false, network: true },
  async execute(input, options) {
    const query = typeof input.query === 'string' ? input.query : '';
    const results = await searchWeb(query, options);
    return formatWebResults(results);
  },
};

const ASK_TOOL_REGISTRY = [runtimeClockTool, webSearchTool] as const;

export function getAskToolRegistry(): AskTool[] {
  return [...ASK_TOOL_REGISTRY];
}

export function planAskTools(userText: string): AskToolCall[] {
  const plan = resolveAskToolPlan(userText);
  const calls: AskToolCall[] = [{ toolName: 'runtime_clock', input: {} }];
  if (plan.webSearch && plan.webQuery) {
    calls.push({
      toolName: 'web_search',
      input: {
        query: plan.webQuery,
        ...(plan.reasons.at(-1) && plan.reasons.at(-1) !== 'web_search' ? { reason: plan.reasons.at(-1) } : {}),
      },
    });
  }
  return calls;
}

export async function executeAskToolPlan(
  calls: AskToolCall[],
  options: AskToolContextOptions = {},
): Promise<AskToolResult[]> {
  const registry = new Map(getAskToolRegistry().map((tool) => [tool.name, tool]));
  const results: AskToolResult[] = [];
  for (const call of calls) {
    const tool = registry.get(call.toolName);
    if (!tool) {
      results.push({ toolName: call.toolName, status: 'error', error: 'Unknown Ask tool' });
      continue;
    }
    try {
      results.push({
        toolName: call.toolName,
        status: 'success',
        content: await tool.execute(call.input, options),
      });
    } catch (error) {
      results.push({
        toolName: call.toolName,
        status: 'error',
        error: formatUnknownError(error),
      });
    }
  }
  return results;
}

export async function buildAskToolContext(
  userText: string,
  options: AskToolContextOptions = {},
): Promise<string> {
  const calls = planAskTools(userText);
  const results = await executeAskToolPlan(calls, options);
  const sections = [
    `Tool plan:\nExecuted tools: ${calls.map((call) => call.toolName).join(', ')}${formatSearchQueryLine(calls)}`,
    ...results.map(formatToolResultSection),
  ];
  return sections.map((section) => `<context>\n${section}\n</context>`).join('\n\n');
}

function formatSearchQueryLine(calls: AskToolCall[]): string {
  const searchCall = calls.find((call) => call.toolName === 'web_search');
  const query = searchCall?.input.query;
  return typeof query === 'string' ? `\nWeb query: ${query}` : '';
}

function formatToolResultSection(result: AskToolResult): string {
  if (result.toolName === 'runtime_clock') {
    return result.status === 'success'
      ? `Runtime context:\n${result.content ?? ''}`
      : `Runtime context unavailable:\n${result.error ?? 'unknown error'}`;
  }
  if (result.toolName === 'web_search') {
    return result.status === 'success'
      ? `Web search results:\n${result.content ?? ''}`
      : `Web search unavailable:\n${result.error ?? 'unknown error'}`;
  }
  return result.status === 'success'
    ? `${result.toolName} result:\n${result.content ?? ''}`
    : `${result.toolName} unavailable:\n${result.error ?? 'unknown error'}`;
}

function formatWebResults(results: ReturnType<typeof parseDuckDuckGoHtml>): string {
  return results
    .map((result, index) => `${index + 1}. ${result.title} - ${result.url}${result.snippet ? `\n   ${result.snippet}` : ''}`)
    .join('\n');
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
