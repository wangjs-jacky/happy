import { describe, expect, it } from 'vitest';
import { en } from './translations/en';
import { zhHans } from './translations/zh-Hans';

describe('interactive preview translations', () => {
    it('provides localized provider, title, and retry labels in English and simplified Chinese', () => {
        expect(en.interactivePreviews).toMatchObject({
            title: 'Temporary previews', provider: 'Vercel', retry: 'Retry',
        });
        expect(zhHans.interactivePreviews).toMatchObject({
            title: '临时交互预览', provider: 'Vercel', retry: '重试',
        });
    });
});
