import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { t } from '@/text';
import { HappyError } from '@/utils/errors';
import type { Session } from '@/sync/storageTypes';
import type { Message } from '@/sync/typesMessage';
import { buildOpenBirdTranscriptEnvelope, hasOpenBirdShareContent, type OpenBirdTheme } from '@/utils/openBirdSessionEnvelope';
import { prepareOpenBirdAttachmentUrls } from '@/utils/openBirdShareAssets';
import { publishOpenBirdTranscript } from '@/sync/apiOpenBirdTranscript';

export interface ShareSessionToOpenBirdOptions {
    /** 默认主题，写进信封 theme 字段。缺省 document。 */
    theme?: OpenBirdTheme;
    apiBaseUrl?: string;
}

/**
 * 把一段会话历史分享到 OpenBird：
 *   1. 上传会话内的图片附件，拿到公网 URL（ref → url 映射）。
 *   2. 序列化成通用 transcript 信封（工具→:::details、选项→:::choices、图片以 ![alt](url) 内联进 markdown）。
 *   3. POST 给 OpenBird，拿到临时页 URL。
 *   4. 复制 URL 到剪贴板并提示用户。
 *
 * 交给 useHappyAction 调度，错误直接抛 HappyError 由其统一弹窗。
 */
export async function shareSessionToOpenBird(
    session: Session,
    messages: Message[],
    options: ShareSessionToOpenBirdOptions = {},
): Promise<void> {
    if (!hasOpenBirdShareContent(messages)) {
        throw new HappyError(t('sessionInfo.shareToOpenBirdEmpty'), false);
    }

    // 图片上传失败不应阻断整体分享，退化为无图分享。
    let attachmentUrls: Record<string, string> = {};
    try {
        attachmentUrls = await prepareOpenBirdAttachmentUrls(session.id, messages);
    } catch {
        attachmentUrls = {};
    }

    const envelope = buildOpenBirdTranscriptEnvelope(session, messages, {
        theme: options.theme ?? 'document',
        attachmentUrls,
    });

    let result;
    try {
        result = await publishOpenBirdTranscript(envelope, { apiBaseUrl: options.apiBaseUrl });
    } catch (e) {
        const message = e instanceof Error ? e.message : t('sessionInfo.shareToOpenBirdFailed');
        throw new HappyError(message, true);
    }

    try {
        await Clipboard.setStringAsync(result.url);
    } catch {
        // 复制失败不致命，URL 已经生成，仍然展示给用户。
    }

    Modal.alert(
        t('sessionInfo.shareToOpenBirdSuccess'),
        t('sessionInfo.shareToOpenBirdSuccessMessage', { url: result.url }),
    );
}
