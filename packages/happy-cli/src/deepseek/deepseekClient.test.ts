import { describe, expect, it } from 'vitest';

import { parseDeepSeekSseData } from './deepseekClient';

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
