import { describe, expect, it } from 'vitest';
import { buildAskApiEnvironment, isAskApiConfigured } from './askApiConfig';

describe('ask API config', () => {
    it('keeps Ask availability tied to the DeepSeek-compatible API key', () => {
        expect(isAskApiConfigured({
            apiKey: '',
            baseUrl: '',
            tavilyApiKey: ' tvly-local ',
        })).toBe(false);
    });

    it('builds trimmed environment variables for DeepSeek and Tavily', () => {
        expect(buildAskApiEnvironment({
            apiKey: ' sk-deepseek ',
            baseUrl: ' https://api.deepseek.com/anthropic ',
            tavilyApiKey: ' tvly-local ',
        })).toEqual({
            HAPPY_DEEPSEEK_API_KEY: 'sk-deepseek',
            HAPPY_DEEPSEEK_BASE_URL: 'https://api.deepseek.com/anthropic',
            HAPPY_ASK_TAVILY_API_KEY: 'tvly-local',
        });
    });

    it('omits optional URL and Tavily environment variables when blank', () => {
        expect(buildAskApiEnvironment({
            apiKey: ' sk-deepseek ',
            baseUrl: ' ',
            tavilyApiKey: ' ',
        })).toEqual({
            HAPPY_DEEPSEEK_API_KEY: 'sk-deepseek',
        });
    });
});
