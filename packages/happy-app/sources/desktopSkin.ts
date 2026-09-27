import type { AccentMode } from './themePacksData';

export type DesktopSkinId = 'default' | 'dreamskin';

// DreamSkin cecilylove002 supplies the palette. Paws supplies the interaction
// states that the source package does not define.
export const DREAMSKIN_ACCENT: AccentMode = {
    primary: '#7898BC',
    primaryPressed: '#6488B2',
    onPrimary: '#101820',
    link: '#9ABCE0',
    bg: '#131313',
    surface: '#2A2A2A',
    surfaceHigh: '#343A41',
    surfaceHighest: '#404A55',
    text: '#F0F0F0',
    textSecondary: '#A8AFB8',
    particleA: '#7898BC',
    particleB: '#B9A788',
};

export function isDreamSkinActive(skin: DesktopSkinId, platform: string): boolean {
    return skin === 'dreamskin' && platform === 'web';
}
