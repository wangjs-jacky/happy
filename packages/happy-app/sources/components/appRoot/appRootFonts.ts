import * as Fonts from 'expo-font';
import { Fredoka_600SemiBold, Fredoka_700Bold } from '@expo-google-fonts/fredoka';
import {
    Feather,
    FontAwesome,
    FontAwesome5,
    Ionicons,
    MaterialCommunityIcons,
    MaterialIcons,
    Octicons,
} from '@expo/vector-icons';
import { Platform } from 'react-native';
import { AsyncLock } from '@/utils/lock';
import { markSessionCriticalPathAppStage } from '@/sync/sessionCriticalPathProbeBridge';
import SpaceMono from '@/assets/fonts/SpaceMono-Regular.ttf';
import IBMPlexSansRegular from '@/assets/fonts/IBMPlexSans-Regular.ttf';
import IBMPlexSansItalic from '@/assets/fonts/IBMPlexSans-Italic.ttf';
import IBMPlexSansSemiBold from '@/assets/fonts/IBMPlexSans-SemiBold.ttf';
import IBMPlexMonoRegular from '@/assets/fonts/IBMPlexMono-Regular.ttf';
import IBMPlexMonoItalic from '@/assets/fonts/IBMPlexMono-Italic.ttf';
import IBMPlexMonoSemiBold from '@/assets/fonts/IBMPlexMono-SemiBold.ttf';
import BricolageGrotesqueBold from '@/assets/fonts/BricolageGrotesque-Bold.ttf';

const lock = new AsyncLock();
let loaded = false;
const vectorIconFonts = {
    ...Feather.font,
    ...FontAwesome.font,
    ...FontAwesome5.font,
    ...Ionicons.font,
    ...MaterialCommunityIcons.font,
    ...MaterialIcons.font,
    ...Octicons.font,
};

export async function loadAppRootFonts(): Promise<void> {
    await lock.inLock(async () => {
        if (loaded) return;
        loaded = true;
        const isTauri = Platform.OS === 'web'
            && typeof window !== 'undefined'
            && (window as any).__TAURI_INTERNALS__ !== undefined;
        const fonts = {
            SpaceMono,
            'IBMPlexSans-Regular': IBMPlexSansRegular,
            'IBMPlexSans-Italic': IBMPlexSansItalic,
            'IBMPlexSans-SemiBold': IBMPlexSansSemiBold,
            'IBMPlexMono-Regular': IBMPlexMonoRegular,
            'IBMPlexMono-Italic': IBMPlexMonoItalic,
            'IBMPlexMono-SemiBold': IBMPlexMonoSemiBold,
            'BricolageGrotesque-Bold': BricolageGrotesqueBold,
            'Fredoka-SemiBold': Fredoka_600SemiBold,
            'Fredoka-Bold': Fredoka_700Bold,
            ...vectorIconFonts,
        };

        if (!isTauri) {
            await Fonts.loadAsync(fonts);
            markSessionCriticalPathAppStage('web.fonts.critical_ready');
            return;
        }
        void Fonts.loadAsync(fonts)
            .then(() => markSessionCriticalPathAppStage('web.fonts.critical_ready'))
            .catch(() => undefined);
    });
}
