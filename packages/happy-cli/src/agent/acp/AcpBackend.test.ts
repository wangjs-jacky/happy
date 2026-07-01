import { describe, expect, it } from 'vitest';
import { normalizeAcpPermissionRequest } from './AcpBackend';

describe('normalizeAcpPermissionRequest', () => {
  it('reads standard ACP toolCallId and rawInput fields used by DeepCode', () => {
    const normalized = normalizeAcpPermissionRequest({
      sessionId: 'session-1',
      toolCall: {
        toolCallId: 'call-read',
        title: 'read',
        kind: 'read',
        status: 'pending',
        rawInput: {
          command: '/tmp/workspace/note.txt',
          scopes: ['read-in-cwd'],
        },
      },
      options: [
        { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'allow_always', kind: 'allow_always', name: 'Always allow this permission scope' },
        { optionId: 'reject_once', kind: 'reject_once', name: 'Deny' },
      ],
    }, () => 'fallback-id');

    expect(normalized.toolCallId).toBe('call-read');
    expect(normalized.toolName).toBe('read');
    expect(normalized.input).toEqual({
      command: '/tmp/workspace/note.txt',
      scopes: ['read-in-cwd'],
    });
    expect(normalized.options.map((option) => option.optionId)).toEqual([
      'allow_once',
      'allow_always',
      'reject_once',
    ]);
  });
});
