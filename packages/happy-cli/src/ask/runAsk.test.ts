import { describe, expect, it } from 'vitest';
import {
  buildAskDeepSeekOptions,
  normalizeAskDeepSeekModel,
  resolveAskDeepSeekThinkingMode,
  trimAskHistory,
} from './runAsk';

describe('buildAskDeepSeekOptions', () => {
  it('builds DeepSeek options for ask-only mode without local tools', () => {
    const options = buildAskDeepSeekOptions({
      model: 'deepseek/deepseek-v4-flash',
      effort: 'high',
      systemPrompt: 'Answer directly.',
    });

    expect(options).toMatchObject({
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com',
      thinking: 'disabled',
      reasoningEffort: 'high',
      permissionMode: 'default',
      includePartialMessages: true,
      systemPrompt: 'Answer directly.',
    });
    expect(options).not.toHaveProperty('tools');
    expect(options).not.toHaveProperty('mcpServers');
    expect(options).not.toHaveProperty('allowedTools');
    expect(options).not.toHaveProperty('disallowedTools');
    expect(options).not.toHaveProperty('canUseTool');
    expect(options).not.toHaveProperty('allowDangerouslySkipPermissions');
  });
});

describe('normalizeAskDeepSeekModel', () => {
  it('accepts DeepSeek namespaced and direct model ids', () => {
    expect(normalizeAskDeepSeekModel('deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(normalizeAskDeepSeekModel('deepseek-v4-flash')).toBe('deepseek-v4-flash');
  });

  it('falls back when the app sends a non-DeepSeek model id', () => {
    expect(normalizeAskDeepSeekModel('gpt-image-2')).toBe('deepseek-v4-flash');
    expect(normalizeAskDeepSeekModel(null)).toBe('deepseek-v4-flash');
  });
});

describe('resolveAskDeepSeekThinkingMode', () => {
  it('enables thinking only for the pro model by default', () => {
    expect(resolveAskDeepSeekThinkingMode('deepseek-v4-flash')).toBe('disabled');
    expect(resolveAskDeepSeekThinkingMode('deepseek-v4-pro')).toBe('enabled');
  });
});

describe('trimAskHistory', () => {
  it('keeps the system prompt and the newest messages', () => {
    const history = [
      { role: 'system' as const, content: 'system' },
      { role: 'user' as const, content: '1' },
      { role: 'assistant' as const, content: '2' },
      { role: 'user' as const, content: '3' },
      { role: 'assistant' as const, content: '4' },
    ];

    trimAskHistory(history, 2);

    expect(history).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: '3' },
      { role: 'assistant', content: '4' },
    ]);
  });
});
