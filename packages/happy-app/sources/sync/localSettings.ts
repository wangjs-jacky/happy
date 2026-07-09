import * as z from 'zod';
import { AgentLauncherListSchema } from './settings';

//
// Schema
//

export const LocalSettingsSchema = z.object({
    // Developer settings (device-specific)
    debugMode: z.boolean().describe('Enable debug logging'),
    devModeEnabled: z.boolean().describe('Enable developer menu in settings'),
    voiceUpsellOverride: z.enum(['control', 'show-paywall-before-first-voice-chat', 'voice-onboarding-and-upsell']).nullable().describe('Developer-only local override for the voice-upsell PostHog flag'),
    commandPaletteEnabled: z.boolean().describe('Enable CMD+K command palette (web only)'),
    themePreference: z.enum(['light', 'dark', 'adaptive']).describe('Theme preference: light, dark, or adaptive (follows system)'),
    themePack: z.enum(['caramel', 'gingham', 'terminal', 'acorn', 'sage', 'sakura', 'grape']).describe('Color theme pack (brand accent variant)'),
    mascot: z.enum(['hoodie', 'explorer', 'astro', 'barista', 'ninja', 'scientist', 'florist']).describe('Mascot character shown on the empty home screen and settings header'),
    markdownCopyV2: z.boolean().describe('Replace native paragraph selection with long-press modal for full markdown copy'),
    consoleLoggingEnabled: z.boolean().describe('Enable console output in production builds'),
    verboseLogging: z.boolean().describe('Log all network requests and responses'),
    zenMode: z.boolean().describe('Hide all sidebars and non-essential UI for focused work'),
    hapticFeedbackEnabled: z.boolean().describe('Enable haptic (vibration) feedback for interactions'),
    askApi: z.object({
        apiKey: z.string().describe('DeepSeek-compatible API key for Ask mode'),
        baseUrl: z.string().describe('Optional DeepSeek-compatible API base URL for Ask mode'),
        tavilyApiKey: z.string().optional().default('').describe('Optional Tavily API key for Ask mode web search'),
    }).describe('Device-local Ask mode API credentials'),
    // CLI version acknowledgments - keyed by machineId
    acknowledgedCliVersions: z.record(z.string(), z.string()).describe('Acknowledged CLI versions per machine'),
    // 「我的 Agent」启动预设。**刻意放在设备本地、不随账号同步**：账号设置是「单一加密 blob +
    // 乐观锁 + POST 整包覆盖、后写赢」，App 各种 churn 写入会把 agents 一起带上，某次本地为空即把
    // 服务器覆盖空，导致新建 Agent 退出重进就丢。放本地后任何同步/WS 回包都碰不到它，彻底解决。
    agents: AgentLauncherListSchema.describe('设备本地「我的 Agent」启动预设（不随账号同步）'),
});

//
// NOTE: Local settings are device-specific and should NOT be synced.
// These are preferences that make sense to be different on each device.
//

const LocalSettingsSchemaPartial = LocalSettingsSchema.passthrough().partial();

export type LocalSettings = z.infer<typeof LocalSettingsSchema>;

//
// Defaults
//

export const localSettingsDefaults: LocalSettings = {
    debugMode: false,
    devModeEnabled: false,
    voiceUpsellOverride: null,
    commandPaletteEnabled: false,
    themePreference: 'adaptive',
    themePack: 'caramel',
    mascot: 'hoodie',
    markdownCopyV2: false,
    consoleLoggingEnabled: false,
    verboseLogging: false,
    zenMode: false,
    hapticFeedbackEnabled: true,
    askApi: {
        apiKey: '',
        baseUrl: '',
        tavilyApiKey: '',
    },
    acknowledgedCliVersions: {},
    agents: [],
};
Object.freeze(localSettingsDefaults);

//
// Parsing
//

export function localSettingsParse(settings: unknown): LocalSettings {
    const parsed = LocalSettingsSchemaPartial.safeParse(settings);
    if (!parsed.success) {
        return { ...localSettingsDefaults };
    }
    return {
        ...localSettingsDefaults,
        ...parsed.data,
        askApi: {
            ...localSettingsDefaults.askApi,
            ...parsed.data.askApi,
        },
    };
}

//
// Applying changes
//

export function applyLocalSettings(settings: LocalSettings, delta: Partial<LocalSettings>): LocalSettings {
    return { ...localSettingsDefaults, ...settings, ...delta };
}
