import { afterEach, describe, expect, it, vi } from 'vitest';

const marks: string[] = [];
const loadedFontMaps: Array<Record<string, unknown>> = [];

vi.mock('expo-font', () => ({
    loadAsync: vi.fn(async (fonts: Record<string, unknown>) => {
        loadedFontMaps.push(fonts);
        marks.push('font-loaded');
    }),
}));
vi.mock('@expo-google-fonts/fredoka', () => ({
    Fredoka_600SemiBold: 'fredoka-semibold',
    Fredoka_700Bold: 'fredoka-bold',
}));
vi.mock('@expo/vector-icons', () => {
    const font = {};
    return {
        Feather: { font },
        FontAwesome: { font },
        FontAwesome5: { font },
        Ionicons: { font },
        MaterialCommunityIcons: { font },
        MaterialIcons: { font },
        Octicons: { font },
    };
});
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@/assets/fonts/SpaceMono-Regular.ttf', () => ({ default: 'space-mono' }));
vi.mock('@/assets/fonts/IBMPlexSans-Regular.ttf', () => ({ default: 'plex-sans' }));
vi.mock('@/assets/fonts/IBMPlexSans-Italic.ttf', () => ({ default: 'plex-sans-italic' }));
vi.mock('@/assets/fonts/IBMPlexSans-SemiBold.ttf', () => ({ default: 'plex-sans-semibold' }));
vi.mock('@/assets/fonts/MapleMonoNL-Regular.ttf', () => ({ default: 'maple-mono' }));
vi.mock('@/assets/fonts/MapleMonoNL-Italic.ttf', () => ({ default: 'maple-mono-italic' }));
vi.mock('@/assets/fonts/MapleMonoNL-SemiBold.ttf', () => ({ default: 'maple-mono-semibold' }));
vi.mock('@/assets/fonts/BricolageGrotesque-Bold.ttf', () => ({ default: 'bricolage-bold' }));

import { loadAppRootFonts } from './appRootFonts';

describe('app root fonts', () => {
    afterEach(() => {
        delete (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe;
        marks.length = 0;
        loadedFontMaps.length = 0;
    });

    it('marks critical fonts ready only after the font load resolves', async () => {
        // Catches a boot metric claiming font readiness before renderable fonts exist.
        (globalThis as { __happySessionCriticalPathProbe?: unknown }).__happySessionCriticalPathProbe = {
            markAppStage: () => marks.push('critical-ready'),
        };
        vi.stubGlobal('require', () => 'font-asset');

        await loadAppRootFonts();

        expect(marks).toEqual(['font-loaded', 'critical-ready']);
        expect(loadedFontMaps[0]).toMatchObject({
            'MapleMonoNL-Regular': expect.anything(),
            'MapleMonoNL-Italic': expect.anything(),
            'MapleMonoNL-SemiBold': expect.anything(),
        });
        expect(loadedFontMaps[0]).not.toHaveProperty('IBMPlexMono-Regular');
    });
});
