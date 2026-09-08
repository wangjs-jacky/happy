import { describe, expect, it } from 'vitest';
import { en as defaults } from './_default';
import { en } from './translations/en';
import { ca } from './translations/ca';
import { es } from './translations/es';
import { it as italian } from './translations/it';
import { pl } from './translations/pl';
import { pt } from './translations/pt';
import { ru } from './translations/ru';
import { ja } from './translations/ja';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';

const locales = { en, ca, es, it: italian, pl, pt, ru, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant };
const technicalLabels = new Set(['githubCli', 'pawsCli', 'cloudflareWrangler', 'cloudflared',
    'egoAppVersion', 'egoCliVersion', 'egoChromiumVersion', 'egoNodeVersion']);
const params = { ready: 2, total: 5, version: 'VERSION_TEST', from: 'FROM_TEST',
    actions: 'ACTION_A\nACTION_B', accounts: 'ACCOUNT_TEST', component: 'COMPONENT_TEST' };

describe('Device Environment translations', () => {
    it.each(Object.entries(locales))('%s localizes every message and preserves interpolation contracts', (locale, translation) => {
        const messages = translation.deviceEnvironment;
        expect(Object.keys(messages).sort()).toEqual(Object.keys(defaults.deviceEnvironment).sort());
        const untranslated: string[] = [];
        for (const key of Object.keys(defaults.deviceEnvironment) as (keyof typeof defaults.deviceEnvironment)[]) {
            const baseline = defaults.deviceEnvironment[key];
            const value = messages[key];
            expect(typeof value, key).toBe(typeof baseline);
            const rendered = typeof value === 'function' ? value(params) : value;
            const english = typeof baseline === 'function' ? baseline(params) : baseline;
            expect(rendered, key).not.toMatch(/undefined|\[object Object\]/);
            for (const token of Object.values(params).filter((item): item is string => typeof item === 'string')) {
                if (english.includes(token)) expect(rendered, key).toContain(token);
            }
            if (locale !== 'en' && !technicalLabels.has(key) && rendered === english) untranslated.push(key);
        }
        expect(untranslated).toEqual([]);
    });
});
