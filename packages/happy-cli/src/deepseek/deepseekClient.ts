export type DeepSeekRole = 'system' | 'user' | 'assistant';

export type DeepSeekChatMessage = {
  role: DeepSeekRole;
  content: string;
};

export type DeepSeekThinkingMode = 'enabled' | 'disabled';

export type DeepSeekUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
};

export type DeepSeekStreamDelta = {
  contentDelta?: string;
  reasoningDelta?: string;
  finishReason?: string | null;
  usage?: DeepSeekUsage;
};

export type StreamDeepSeekChatOptions = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  messages: DeepSeekChatMessage[];
  thinking?: DeepSeekThinkingMode;
  reasoningEffort?: 'high' | 'max';
  signal?: AbortSignal;
};

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_FAST_MODEL = 'deepseek-v4-flash';
export const DEEPSEEK_PRO_MODEL = 'deepseek-v4-pro';

export const DEEPSEEK_MODELS = [
  { code: DEEPSEEK_FAST_MODEL, value: 'deepseek v4 flash', description: 'fastest direct API path' },
  { code: DEEPSEEK_PRO_MODEL, value: 'deepseek v4 pro', description: 'higher quality, slower than flash' },
] as const;

function endpoint(baseUrl: string | undefined): string {
  return `${(baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;
}

function payloadFor(options: StreamDeepSeekChatOptions): Record<string, unknown> {
  const thinking = options.thinking ?? 'disabled';
  return {
    model: options.model,
    messages: options.messages,
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: thinking },
    ...(thinking === 'enabled' ? { reasoning_effort: options.reasoningEffort ?? 'high' } : {}),
  };
}

export function parseDeepSeekSseData(data: string): 'done' | DeepSeekStreamDelta | null {
  const trimmed = data.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed === '[DONE]') {
    return 'done';
  }

  const parsed = JSON.parse(trimmed) as {
    choices?: Array<{
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
      };
      finish_reason?: string | null;
    }>;
    usage?: DeepSeekUsage | null;
  };
  const first = parsed.choices?.[0];
  const contentDelta = first?.delta?.content ?? undefined;
  const reasoningDelta = first?.delta?.reasoning_content ?? undefined;
  const finishReason = first?.finish_reason;
  const usage = parsed.usage ?? undefined;

  if (!contentDelta && !reasoningDelta && finishReason === undefined && !usage) {
    return null;
  }

  return {
    ...(contentDelta ? { contentDelta } : {}),
    ...(reasoningDelta ? { reasoningDelta } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    ...(usage ? { usage } : {}),
  };
}

function collectSseDataLines(block: string): string[] {
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  return dataLines;
}

export async function* streamDeepSeekChat(options: StreamDeepSeekChatOptions): AsyncGenerator<DeepSeekStreamDelta> {
  const response = await fetch(endpoint(options.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(payloadFor(options)),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const suffix = text ? `: ${text.slice(0, 1000)}` : '';
    throw new Error(`DeepSeek API request failed with HTTP ${response.status}${suffix}`);
  }
  if (!response.body) {
    throw new Error('DeepSeek API response did not include a stream body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      for (const data of collectSseDataLines(block)) {
        const parsed = parseDeepSeekSseData(data);
        if (parsed === 'done') {
          return;
        }
        if (parsed) {
          yield parsed;
        }
      }
    }
  }

  buffer += decoder.decode();
  for (const data of collectSseDataLines(buffer)) {
    const parsed = parseDeepSeekSseData(data);
    if (parsed === 'done') {
      return;
    }
    if (parsed) {
      yield parsed;
    }
  }
}
