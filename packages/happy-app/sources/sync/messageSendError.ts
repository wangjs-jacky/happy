import { t } from '@/text';

/** 附件失败保留机器可读原因，由调用页面统一呈现本地化提示。 */
export class AttachmentSendError extends Error {
    constructor(
        readonly code: 'attachment-upload-failed' | 'attachments-unsupported',
        readonly failedCount: number,
        readonly causes: unknown[] = [],
    ) {
        super(code === 'attachment-upload-failed'
            ? t('imageUpload.uploadFailedMessage', { count: failedCount })
            : t('imageUpload.notSupportedMessage'));
        this.name = 'AttachmentSendError';
    }
}

export function describeMessageSendError(error: unknown, fallback: string): string {
    // 网络异常可能包含签名 URL；只展示明确允许呈现的附件错误。
    return error instanceof AttachmentSendError ? error.message : fallback;
}
