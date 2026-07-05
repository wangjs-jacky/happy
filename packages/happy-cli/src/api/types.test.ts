import { describe, expect, it } from 'vitest';
import { MessageMetaSchema } from './types';

describe('MessageMetaSchema', () => {
  it('preserves reasoning effort metadata', () => {
    const meta = MessageMetaSchema.parse({
      model: 'gpt-5.5',
      effort: 'xhigh',
    });

    expect(meta).toMatchObject({
      model: 'gpt-5.5',
      effort: 'xhigh',
    });
  });
});
