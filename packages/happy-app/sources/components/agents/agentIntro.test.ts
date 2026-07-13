import { describe, it, expect, vi } from 'vitest';

// Set __DEV__ before any imports
declare global {
    var __DEV__: boolean;
}
globalThis.__DEV__ = false;

// Mock react-native and dependent modules before importing agentIntro
vi.mock('react-native', () => ({
    StyleSheet: { create: (fn: any) => fn({}, {}) },
    ScrollView: () => null,
    View: () => null,
    Text: () => null,
    Pressable: () => null,
    ActivityIndicator: () => null,
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: () => null,
}));

vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (fn: any) => fn({}, {}) },
    useUnistyles: () => ({ theme: {}, styles: {} }),
}));

vi.mock('@/components/rightPanel/HealthCheckinPanel', () => ({
    isHealthCheckinSession: (path: string | null | undefined) => {
        return !!path && path.includes('健康打卡');
    },
}));

import { resolveAgentIntroKind } from './agentIntro';

describe('resolveAgentIntroKind', () => {
    it('健康打卡路径 → health', () => {
        expect(resolveAgentIntroKind({ path: '/Users/jacky/jacky-obsidian/人生辅助系统/健康打卡' })).toBe('health');
    });
    it('普通路径 → generic', () => {
        expect(resolveAgentIntroKind({ path: '/Users/jacky/jacky-github/foo' })).toBe('generic');
    });
    it('空路径 → generic', () => {
        expect(resolveAgentIntroKind({ path: '' })).toBe('generic');
    });
});
