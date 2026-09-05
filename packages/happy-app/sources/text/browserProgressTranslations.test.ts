import { describe, expect, it } from 'vitest';
import { ca } from './translations/ca';
import { en } from './translations/en';
import { es } from './translations/es';
import { it as italian } from './translations/it';
import { ja } from './translations/ja';
import { pl } from './translations/pl';
import { pt } from './translations/pt';
import { ru } from './translations/ru';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';

describe('browser progress translations', () => {
    it('provides locale-appropriate copy instead of English placeholders', () => {
        for (const translation of [ca, es, italian, ja, pl, pt, ru, zhHans, zhHant]) {
            expect(translation.rightPanelCapabilityHub.browserProgress.title).not.toBe(en.rightPanelCapabilityHub.browserProgress.title);
            expect(translation.rightPanelCapabilityHub.browserProgress.view).not.toBe(en.rightPanelCapabilityHub.browserProgress.view);
            expect(translation.rightPanelCapabilityHub.browserProgress.close).not.toBe(en.rightPanelCapabilityHub.browserProgress.close);
            expect(translation.rightPanelCapabilityHub.browserProgress.timelineTitle).not.toBe(en.rightPanelCapabilityHub.browserProgress.timelineTitle);
            expect(translation.rightPanelCapabilityHub.browserProgress.liveCount({ count: 7 })).toContain('7');
            const position = translation.rightPanelCapabilityHub.browserProgress.stepPosition({ current: 2, total: 7 });
            expect(position).toContain('2');
            expect(position).toContain('7');
        }
    });
});
