import { describe, expect, it, vi } from 'vitest';
import { AttachmentSendError, describeMessageSendError } from './messageSendError';

vi.mock('@/text', () => ({ t: (key: string, params?: { count: number }) => `${key}:${params?.count ?? ''}` }));

describe('发送失败的用户提示边界', () => {
    it('网络和内部异常只显示调用方提供的安全提示', () => {
        expect(describeMessageSendError(new Error('https://storage.invalid/?signature=private'), 'safe-fallback')).toBe('safe-fallback');
        expect(describeMessageSendError('private-raw-error', 'safe-fallback')).toBe('safe-fallback');
    });

    it('保留附件异常的原因供诊断，用户提示不包含底层 URL', () => {
        const cause = new Error('https://storage.invalid/?signature=private');
        const error = new AttachmentSendError('attachment-upload-failed', 2, [cause]);
        expect(error.code).toBe('attachment-upload-failed');
        expect(error.failedCount).toBe(2);
        expect(error.causes).toEqual([cause]);
        expect(describeMessageSendError(error, 'fallback')).toBe(error.message);
        expect(error.message).not.toContain('signature=private');
    });
});
