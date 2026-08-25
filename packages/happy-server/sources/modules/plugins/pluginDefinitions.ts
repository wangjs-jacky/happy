import type { PluginInstallationStatus, PluginManifest } from '@slopus/happy-wire';
import { z } from 'zod';

export interface PluginDefinition {
    manifest: PluginManifest;
    normalizeConfiguration: (configuration: Record<string, string>) => Record<string, string>;
    redactConfiguration: (configuration: Record<string, string>) => Extract<PluginInstallationStatus, { installed: true }>;
}

const providerBaseUrlSchema = z.string().trim().url().max(2_000).refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:'
        && !url.username
        && !url.password
        && !url.search
        && !url.hash;
}, 'Provider URL must be a credential-free HTTPS URL');

const relationshipAdvisorConfigurationSchema = z.object({
    apiKey: z.string().trim().min(1).max(500),
    baseUrl: providerBaseUrlSchema,
    model: z.string().trim().min(1).max(200),
}).strict();

const generatedImagesConfigurationSchema = z.object({}).strict();

function localized(defaultText: string, simplifiedChinese: string, traditionalChinese: string) {
    return {
        default: defaultText,
        translations: {
            'zh-Hans': simplifiedChinese,
            'zh-Hant': traditionalChinese,
        },
    };
}

const relationshipAdvisorManifest: PluginManifest = {
    schemaVersion: 1,
    id: 'relationship-advisor',
    version: '1.0.0',
    title: localized('Relationship Advisor', '狗头军师', '狗頭軍師'),
    description: localized(
        'Analyze conversations and get advice using your configured AI provider.',
        '使用你配置的 AI 提供商分析对话并获取建议。',
        '使用你設定的 AI 供應商分析對話並取得建議。',
    ),
    icon: 'chatbubbles-outline',
    featured: true,
    installedAction: 'configure',
    entrypoint: { type: 'app-route', routeId: 'relationship-advisor' },
    configuration: {
        notice: localized(
            'Your configuration, including the API key, is encrypted and stored on your Paws server.',
            '包括 API 密钥在内的配置会加密保存在你的 Paws 服务器中。',
            '包括 API 金鑰在內的設定會加密儲存在你的 Paws 伺服器中。',
        ),
        fields: [
            {
                key: 'apiKey',
                type: 'secret',
                required: true,
                label: localized('API key', 'API 密钥', 'API 金鑰'),
                placeholder: localized('Enter API key', '输入 API 密钥', '輸入 API 金鑰'),
            },
            {
                key: 'baseUrl',
                type: 'url',
                required: true,
                label: localized('Provider URL', '提供商地址', '供應商網址'),
                placeholder: { default: 'https://api.openai.com/v1' },
            },
            {
                key: 'model',
                type: 'text',
                required: true,
                label: localized('Model', '模型', '模型'),
                placeholder: { default: 'gpt-4.1-mini' },
            },
        ],
    },
};

const generatedImagesManifest: PluginManifest = {
    schemaVersion: 1,
    id: 'generated-images-gallery',
    version: '1.0.0',
    title: localized('Generated Images', '生成图片', '生成圖片'),
    description: localized(
        'Browse images generated in your conversations.',
        '浏览对话中生成的图片。',
        '瀏覽對話中生成的圖片。',
    ),
    icon: 'albums-outline',
    featured: true,
    installedAction: 'open',
    entrypoint: { type: 'app-route', routeId: 'generated-images-gallery' },
    configuration: { fields: [] },
};

export const pluginDefinitions: readonly PluginDefinition[] = [
    {
        manifest: relationshipAdvisorManifest,
        normalizeConfiguration(configuration) {
            const parsed = relationshipAdvisorConfigurationSchema.parse(configuration);
            return {
                apiKey: parsed.apiKey,
                baseUrl: parsed.baseUrl.replace(/\/+$/, ''),
                model: parsed.model,
            };
        },
        redactConfiguration(configuration) {
            const parsed = relationshipAdvisorConfigurationSchema.parse(configuration);
            return {
                installed: true,
                version: relationshipAdvisorManifest.version,
                configuration: {
                    baseUrl: parsed.baseUrl,
                    model: parsed.model,
                },
                secretHints: {
                    apiKey: parsed.apiKey.length > 4 ? parsed.apiKey.slice(-4) : '••••',
                },
            };
        },
    },
    {
        manifest: generatedImagesManifest,
        normalizeConfiguration(configuration) {
            generatedImagesConfigurationSchema.parse(configuration);
            return {};
        },
        redactConfiguration() {
            return {
                installed: true,
                version: generatedImagesManifest.version,
                configuration: {},
                secretHints: {},
            };
        },
    },
];
