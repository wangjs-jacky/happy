import { describe, expect, it } from 'vitest';
import { en as defaultEn } from './_default';
import { ca } from './translations/ca';
import { en } from './translations/en';
import { es } from './translations/es';
import { it as itTranslations } from './translations/it';
import { ja } from './translations/ja';
import { pl } from './translations/pl';
import { pt } from './translations/pt';
import { ru } from './translations/ru';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';

const translations = {
    defaultEn,
    en,
    ca,
    es,
    it: itTranslations,
    ja,
    pl,
    pt,
    ru,
    zhHans,
    zhHant,
};

const restartRequiredTitles = {
    defaultEn: 'Restart Required',
    en: 'Restart Required',
    ca: 'Cal reiniciar',
    es: 'Se requiere reiniciar',
    it: 'Riavvio necessario',
    ja: '再起動が必要です',
    pl: 'Wymagane ponowne uruchomienie',
    pt: 'É necessário reiniciar',
    ru: 'Требуется перезапуск',
    zhHans: '需要重启应用',
    zhHant: '需要重新啟動應用程式',
} as const;

const staticDeveloperKeys = [
    'developerTitle',
    'developerFooter',
    'experimentOverrideTitle',
    'experimentOverrideSubtitle',
    'experimentOverrideDescription',
    'experimentOverrideNone',
    'experimentOverrideControl',
    'experimentOverrideSoftPaywall',
    'experimentOverrideOnboardingUpsell',
    'experimentStatusTitle',
    'experimentStatusDirectByoAgent',
    'experimentStatusServerGate',
    'experimentSourceOverride',
    'experimentSourcePosthog',
    'experimentSourceDefault',
    'resetCountersTitle',
    'resetCountersMessage',
    'resetCountersConfirm',
] as const;

describe('settingsVoice developer translations', () => {
    for (const [language, translation] of Object.entries(translations)) {
        it(`${language} provides every static developer label`, () => {
            const settingsVoice = translation.settingsVoice as Record<string, unknown>;

            for (const key of staticDeveloperKeys) {
                expect(settingsVoice[key], key).toEqual(expect.any(String));
                expect((settingsVoice[key] as string).trim(), key).not.toBe('');
            }
        });

        it(`${language} formats every dynamic developer diagnostic`, () => {
            const settingsVoice = translation.settingsVoice as Record<string, unknown>;

            expect((settingsVoice.experimentStatusVariant as (params: { value: string }) => string)({ value: 'VARIANT_VALUE' }))
                .toContain('VARIANT_VALUE');
            expect((settingsVoice.experimentStatusSource as (params: { value: string }) => string)({ value: 'SOURCE_VALUE' }))
                .toContain('SOURCE_VALUE');
            expect((settingsVoice.experimentStatusGate as (params: { value: string }) => string)({ value: 'GATE_VALUE' }))
                .toContain('GATE_VALUE');
            expect((settingsVoice.experimentStatusExperiments as (params: { enabled: boolean }) => string)({ enabled: true }))
                .not.toBe((settingsVoice.experimentStatusExperiments as (params: { enabled: boolean }) => string)({ enabled: false }));
            expect((settingsVoice.counterSoftPaywallShown as (params: { count: number }) => string)({ count: 17 }))
                .toContain('17');
            expect((settingsVoice.counterOnboardingPromptLoads as (params: { count: number }) => string)({ count: 23 }))
                .toContain('23');
            expect((settingsVoice.counterVoiceMessages as (params: { count: number }) => string)({ count: 42 }))
                .toContain('42');
        });
    }
});

describe('settingsLanguage restart confirmation title', () => {
    for (const [language, translation] of Object.entries(translations)) {
        it(`${language} asks for a restart before the user confirms`, () => {
            expect(translation.settingsLanguage.needsRestart)
                .toBe(restartRequiredTitles[language as keyof typeof restartRequiredTitles]);
        });
    }
});

describe('deviceEnvironment translations', () => {
    const required = [
        'title', 'subtitle', 'fleetReady', 'scanAll', 'scanning', 'previewAlignment',
        'confirmTitle', 'confirmMessage', 'confirmAction', 'applying', 'completed',
        'githubCli', 'daemonOnline', 'daemonOffline', 'offlineRecovery', 'versionInstalled', 'versionTarget',
        'authReady', 'authMissing', 'authUnknown', 'actionNone', 'actionInstall',
        'actionUpgrade', 'actionManualRepair', 'repairWithSsh', 'scanAgain',
        'stateUnknown', 'partialFailure', 'versionSourceMismatch', 'homebrewMissing',
        'unsupportedMachine', 'operationInProgress', 'planExpired',
    ];
    for (const [language, translation] of Object.entries(translations)) {
        it(`${language} provides complete device labels and preserves exact action parameters`, () => {
            const environment = (translation as unknown as Record<string, any>).deviceEnvironment;
            expect(environment).toBeDefined();
            for (const key of required) expect(['string', 'function']).toContain(typeof environment[key]);
            for (const value of Object.values(environment)) {
                if (typeof value === 'string') expect(value.trim()).not.toBe('');
            }
            expect(Object.keys(environment).sort()).toEqual(Object.keys((defaultEn as unknown as Record<string, any>).deviceEnvironment).sort());
            expect(environment.fleetReady({ ready: 2, total: 3 })).toContain('2/3');
            expect(environment.versionInstalled({ version: '2.79.0' })).toContain('2.79.0');
            expect(environment.versionTarget({ version: '2.80.0' })).toContain('2.80.0');
            expect(environment.actionInstall({ version: '2.80.0' })).toContain('2.80.0');
            const upgrade = environment.actionUpgrade({ from: '2.79.0', version: '2.80.0' });
            expect(upgrade).toContain('2.79.0');
            expect(upgrade).toContain('2.80.0');
            expect(environment.confirmMessage({ actions: 'MACHINE: EXACT ACTION' })).toContain('MACHINE: EXACT ACTION');
        });
    }
});
