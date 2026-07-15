import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { t } from '@/text';
import { HappyError } from '@/utils/errors';
import type { Session } from '@/sync/storageTypes';
import type { Message } from '@/sync/typesMessage';
import { buildOpenBirdTranscriptEnvelope, hasOpenBirdShareContent, type OpenBirdTheme } from '@/utils/openBirdSessionEnvelope';
import { prepareOpenBirdAttachmentUrls } from '@/utils/openBirdShareAssets';
import { publishOpenBirdTranscript } from '@/sync/apiOpenBirdTranscript';
import { loadOpenBirdShareLink, saveOpenBirdShareLink } from '@/sync/persistence';

export interface ShareSessionToOpenBirdOptions {
    /** 默认主题，写进信封 theme 字段。缺省 document。 */
    theme?: OpenBirdTheme;
    apiBaseUrl?: string;
}

/** 复制文本到剪贴板，失败不致命（吞掉异常）。 */
async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await Clipboard.setStringAsync(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * 真正执行一次发布：序列化 → 上传图片 → POST → 记住链接 → 复制 URL → 提示。
 * 无论是首次分享还是「重新发布」都走这里。
 */
async function publishSessionToOpenBird(
    session: Session,
    messages: Message[],
    options: ShareSessionToOpenBirdOptions,
): Promise<string> {
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

    // 记住本会话最近一次分享链接，供下次「复制已有链接 / 重新发布」使用。
    saveOpenBirdShareLink(session.id, { url: result.url, sharedAt: Date.now() });

    await copyToClipboard(result.url);

    Modal.alert(
        t('sessionInfo.shareToOpenBirdSuccess'),
        t('sessionInfo.shareToOpenBirdSuccessMessage', { url: result.url }),
    );

    return result.url;
}

/**
 * 把一段会话历史分享到 OpenBird。
 *
 * 行为：
 *   - 该会话尚无历史链接 → 直接发布（上传图片 → 序列化 → POST → 记住 → 复制 → 提示）。
 *   - 已有历史链接 → 弹选择「复制已有链接 / 重新发布」：
 *       · 复制已有链接：走剪贴板 + toast，不再请求。
 *       · 重新发布：重新序列化 + POST 生成新链接并更新记录。
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

    const existing = loadOpenBirdShareLink(session.id);
    if (!existing) {
        await publishSessionToOpenBird(session, messages, options);
        return;
    }

    // 已有历史链接：让用户选择复制还是重新发布。Modal.alert 是同步弹窗，
    // 复制/重新发布的实际动作放到按钮回调里执行。
    Modal.alert(
        t('sessionInfo.shareToOpenBirdExistingTitle'),
        t('sessionInfo.shareToOpenBirdExistingMessage', { url: existing.url }),
        [
            {
                text: t('sessionInfo.shareToOpenBirdCopyExisting'),
                onPress: () => {
                    void (async () => {
                        const copied = await copyToClipboard(existing.url);
                        Modal.alert(
                            t('sessionInfo.shareToOpenBirdSuccess'),
                            copied
                                ? t('sessionInfo.shareToOpenBirdCopiedMessage', { url: existing.url })
                                : existing.url,
                        );
                    })();
                },
            },
            {
                text: t('sessionInfo.shareToOpenBirdRepublish'),
                onPress: () => {
                    void publishSessionToOpenBird(session, messages, options).catch((e) => {
                        const message = e instanceof HappyError
                            ? e.message
                            : (e instanceof Error ? e.message : t('sessionInfo.shareToOpenBirdFailed'));
                        Modal.alert('Error', message, [{ text: 'OK', style: 'cancel' }]);
                    });
                },
            },
            { text: t('common.cancel'), style: 'cancel' },
        ],
    );
}
