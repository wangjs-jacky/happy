import { describe, expect, it } from 'vitest';
import {
    extractMessageOtaPreviews,
    extractSessionOtaPreviews,
    getOtaPreviewCurrentUpdateIds,
    getOtaPreviewPrimaryAction,
} from './sessionOtaPreviews';
import type { AgentTextMessage, Message } from '@/sync/typesMessage';

function agentMessage(text: string, id: string = 'msg-1'): AgentTextMessage {
    return {
        kind: 'agent-text',
        id,
        localId: null,
        createdAt: Date.now(),
        text,
    };
}

describe('sessionOtaPreviews', () => {
    it('extracts tagged happy ota preview blocks', () => {
        const previews = extractMessageOtaPreviews(agentMessage(`
            preview is ready

            <happy-ota-preview>
            title: Settings brand profile
            channel: preview
            platform: android
            runtimeVersion: 21
            updateId: 37fdee5f-0417-b135-d7aa-248634dccd37
            stamp: 1751600000000
            manifestUrl: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/1751600000000.json
            sourceUrl: https://github.com/wangjs-jacky/happy/pull/123
            summary: workflow_dispatch skipped the PR comment step, but the OTA itself is live.
            </happy-ota-preview>
        `));

        expect(previews).toHaveLength(1);
        expect(previews[0]).toMatchObject({
            title: 'Settings brand profile',
            channel: 'preview',
            platform: 'android',
            runtimeVersion: '21',
            updateId: '37fdee5f-0417-b135-d7aa-248634dccd37',
            stamp: '1751600000000',
            sourceUrl: 'https://github.com/wangjs-jacky/happy/pull/123',
        });
    });

    it('extracts legacy ota summary bullets from assistant text', () => {
        const previews = extractMessageOtaPreviews(agentMessage(`
            ### 📲 预览 OTA 已发布

            • Channel: preview
            • Platform: android
            • runtimeVersion: 21
            • Update ID: 37fdee5f-0417-b135-d7aa-248634dccd37
            • Manifest: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json
        `));

        expect(previews).toHaveLength(1);
        expect(previews[0]).toMatchObject({
            source: 'legacy',
            title: '📲 预览 OTA 已发布',
            channel: 'preview',
            platform: 'android',
            runtimeVersion: '21',
            manifestUrl: 'https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json',
            siteUrl: 'https://wangjs-jacky.github.io/happy-ota-site/',
        });
    });

    it('returns previews newest-first across session messages', () => {
        const messages: Message[] = [
            agentMessage(`
                <happy-ota-preview>
                title: newer
                channel: preview
                platform: android
                runtimeVersion: 21
                updateId: newer-id
                manifestUrl: https://example.com/manifests/android/21/preview/2.json
                </happy-ota-preview>
            `, 'newer'),
            agentMessage(`
                <happy-ota-preview>
                title: older
                channel: preview
                platform: android
                runtimeVersion: 21
                updateId: older-id
                manifestUrl: https://example.com/manifests/android/21/preview/1.json
                </happy-ota-preview>
            `, 'older'),
        ];

        const previews = extractSessionOtaPreviews(messages);
        expect(previews.map((preview) => preview.title)).toEqual(['newer', 'older']);
    });

    it('prefers direct switching as the primary action for preview cards with a stamp', () => {
        const [preview] = extractMessageOtaPreviews(agentMessage(`
            <happy-ota-preview>
            title: GPT Image 2 生成图库
            channel: preview
            platform: android
            runtimeVersion: 21
            updateId: e3602528-d2d1-dc08-1002-b90eaa32140b
            stamp: 1783402617662
            manifestUrl: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json
            sourceUrl: https://github.com/wangjs-jacky/happy/pull/151
            summary: Preview OTA 已发布并校验 latest manifest 指向本次图库入口更新。
            </happy-ota-preview>
        `));

        expect(getOtaPreviewPrimaryAction(preview)).toEqual({
            type: 'switch',
            stamp: '1783402617662',
        });
    });

    it('marks the OTA card as current when its update id is already running', () => {
        const [preview] = extractMessageOtaPreviews(agentMessage(`
            <happy-ota-preview>
            title: Preview OTA Card Direct Switch
            channel: preview
            platform: android
            runtimeVersion: 21
            updateId: 3f48b113-3302-77c7-2a73-d3819459cb84
            stamp: 1783421651649
            manifestUrl: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json
            sourceUrl: https://github.com/wangjs-jacky/happy/pull/151
            summary: PR #151 preview OTA 已发布，并通过 OSS latest manifest 与 FC manifest 响应核验。
            </happy-ota-preview>
        `));

        expect(getOtaPreviewPrimaryAction(preview, {
            currentUpdateId: '3f48b113-3302-77c7-2a73-d3819459cb84',
        })).toEqual({
            type: 'current',
        });
    });

    it('marks virtual locked OTA cards as current by their original update id', () => {
        const [preview] = extractMessageOtaPreviews(agentMessage(`
            <happy-ota-preview>
            title: Preview OTA Current Version State
            channel: preview
            platform: android
            runtimeVersion: 21
            updateId: 1d013fbb-45c8-dec9-b226-fd68c6346717
            stamp: 1783422454965
            manifestUrl: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json
            sourceUrl: https://github.com/wangjs-jacky/happy/pull/151
            summary: 已核验 OSS latest manifest 与 FC manifest 都指向本次 preview OTA。
            </happy-ota-preview>
        `));

        expect(getOtaPreviewPrimaryAction(preview, {
            currentUpdateId: '44814bcc-06b9-57cf-9c9b-8b814edda1ae',
            currentUpdateIds: [
                '44814bcc-06b9-57cf-9c9b-8b814edda1ae',
                '1d013fbb-45c8-dec9-b226-fd68c6346717',
            ],
        })).toEqual({
            type: 'current',
        });
    });

    it('derives current update ids from virtual OTA target manifest metadata', () => {
        expect(getOtaPreviewCurrentUpdateIds({
            updateId: '44814bcc-06b9-57cf-9c9b-8b814edda1ae',
            manifest: {
                id: '44814bcc-06b9-57cf-9c9b-8b814edda1ae',
                extra: {
                    otaTarget: {
                        originalUpdateId: '1d013fbb-45c8-dec9-b226-fd68c6346717',
                        virtualUpdateId: '44814bcc-06b9-57cf-9c9b-8b814edda1ae',
                    },
                },
            },
        })).toEqual([
            '44814bcc-06b9-57cf-9c9b-8b814edda1ae',
            '1d013fbb-45c8-dec9-b226-fd68c6346717',
        ]);
    });

    it('keeps PR as the primary action when the OTA card cannot be switched directly', () => {
        const [preview] = extractMessageOtaPreviews(agentMessage(`
            <happy-ota-preview>
            title: Production rollout
            channel: production
            platform: android
            runtimeVersion: 21
            updateId: e3602528-d2d1-dc08-1002-b90eaa32140b
            manifestUrl: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/production/latest.json
            sourceUrl: https://github.com/wangjs-jacky/happy/pull/151
            summary: Production OTA 已发布。
            </happy-ota-preview>
        `));

        expect(getOtaPreviewPrimaryAction(preview)).toEqual({
            type: 'link',
            url: 'https://github.com/wangjs-jacky/happy/pull/151',
        });
    });
});
