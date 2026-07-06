export type AskApiConfig = {
    apiKey: string;
    baseUrl: string;
};

export function isAskApiConfigured(config: AskApiConfig | null | undefined): boolean {
    return !!config?.apiKey.trim();
}

export function buildAskApiEnvironment(config: AskApiConfig): Record<string, string> {
    const apiKey = config.apiKey.trim();
    const baseUrl = config.baseUrl.trim();
    return {
        HAPPY_DEEPSEEK_API_KEY: apiKey,
        ...(baseUrl ? { HAPPY_DEEPSEEK_BASE_URL: baseUrl } : {}),
    };
}
