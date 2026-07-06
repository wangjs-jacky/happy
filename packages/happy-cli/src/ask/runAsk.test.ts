import { describe, expect, it } from 'vitest';
import { buildAskClaudeOptions, mapAskSdkMessage } from './runAsk';

describe('buildAskClaudeOptions', () => {
  it('builds Claude SDK options for ask-only mode without local tools', () => {
    const options = buildAskClaudeOptions({
      model: 'sonnet',
      effort: 'medium',
      systemPrompt: 'Answer directly.',
    });

    expect(options).toMatchObject({
      model: 'sonnet',
      effort: 'medium',
      permissionMode: 'default',
      settingSources: [],
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

describe('mapAskSdkMessage', () => {
  it('maps Claude SDK stream events to Happy turn actions', () => {
    expect(mapAskSdkMessage({
      type: 'stream_event',
      event: { type: 'message_start' },
    } as any)).toEqual([{ type: 'turn-start' }]);

    expect(mapAskSdkMessage({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello' },
      },
    } as any)).toEqual([{ type: 'text', text: 'hello' }]);

    expect(mapAskSdkMessage({
      type: 'result',
      subtype: 'success',
    } as any)).toEqual([{ type: 'turn-end', status: 'completed' }]);
  });

  it('maps non-stream assistant messages as a completed answer fallback', () => {
    expect(mapAskSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'reasoning' },
          { type: 'text', text: 'answer' },
        ],
      },
    } as any)).toEqual([{ type: 'assistant-complete', text: 'answer', thinking: 'reasoning' }]);
  });
});
