import * as Haptics from 'expo-haptics';
import { storage } from '@/sync/storage';

function hapticsEnabled(): boolean {
    // haptics.ts is a plain module (not a hook), so read the current local
    // setting synchronously from the zustand store instead of useLocalSetting.
    return storage.getState().localSettings.hapticFeedbackEnabled ?? true;
}

export function hapticsLight() {
    if (!hapticsEnabled()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function hapticsSelection() {
    if (!hapticsEnabled()) return;
    Haptics.selectionAsync();
}

export function hapticsSuccess() {
    if (!hapticsEnabled()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function hapticsError() {
    if (!hapticsEnabled()) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}
