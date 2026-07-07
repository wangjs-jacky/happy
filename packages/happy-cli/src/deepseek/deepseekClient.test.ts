import { describe, expect, it } from 'vitest';

import { parseDeepSeekSseData, resolveDeepSeekChatEndpoint } from './deepseekClient';

describe('resolveDeepSeekChatEndpoint', () => {
  it('accepts a DeepSeek base URL', () => {
    expect(resolveDeepSeekChatEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/chat/completions');
  });

  it('accepts a full DeepSeek chat completions URL without appending the path twice', () => {
    expect(resolveDeepSeekChatEndpoint('https://api.deepseek.com/chat/completions')).toBe('https://api.deepseek.com/chat/completions');
  });

  it('maps the DeepSeek Anthropic-compatible base URL to the OpenAI-compatible chat endpoint', () => {
    expect(resolveDeepSeekChatEndpoint('https://api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/chat/completions');
  });
});

describe('parseDeepSeekSseData', () => {
  it('parses content deltas', () => {
    expect(parseDeepSeekSseData('{"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}')).toEqual({
      contentDelta: 'hello',
      finishReason: null,
    });
  });

  it('parses reasoning deltas', () => {
    expect(parseDeepSeekSseData('{"choices":[{"delta":{"reasoning_content":"think"},"finish_reason":null}]}')).toEqual({
      reasoningDelta: 'think',
      finishReason: null,
    });
  });

  it('parses usage-only chunks', () => {
    expect(parseDeepSeekSseData('{"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}')).toEqual({
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7,
      },
    });
  });

  it('recognizes done chunks', () => {
    expect(parseDeepSeekSseData('[DONE]')).toBe('done');
  });
});
