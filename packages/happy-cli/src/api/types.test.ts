import { describe, expect, it } from 'vitest';
import { MachineMetadataSchema, MessageMetaSchema } from './types';

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

  it('preserves edited user message metadata', () => {
    const meta = MessageMetaSchema.parse({ editedFromMessageId: 'message-1' });

    expect(meta.editedFromMessageId).toBe('message-1');
  });
});

describe('MachineMetadataSchema', () => {
  it('preserves the native model discovery capability and accepts older metadata', () => {
    const metadata = { host: 'machine', platform: 'darwin', happyCliVersion: 'test',
      homeDir: '/home', happyHomeDir: '/home/.happy', happyLibDir: '/lib' };
    expect(MachineMetadataSchema.parse({ ...metadata, capabilities: { codexNativeModels: true } })).toMatchObject({
      capabilities: { codexNativeModels: true },
    });
    expect(MachineMetadataSchema.parse(metadata)).toEqual(metadata);
  });
});
