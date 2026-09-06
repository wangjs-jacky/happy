import * as React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';

import { InteractivePreviewCard } from './InteractivePreviewCard';

const mocks = vi.hoisted(() => ({
    copy: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    theme: null as any,
    themes: null as any,
}));

vi.mock('react-native', () => ({
    Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default },
    Pressable: 'Pressable', Text: 'Text', View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('expo-clipboard', () => ({ setStringAsync: mocks.copy }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: mocks.open }));
vi.mock('@/text', () => ({
    t: (key: string) => ({
        'interactivePreviews.publishing': 'Publishing preview…',
        'interactivePreviews.ready': 'Preview ready',
        'interactivePreviews.failed': 'Preview publishing failed',
        'interactivePreviews.expired': 'Preview expired and removed',
        'interactivePreviews.open': 'Open preview',
        'interactivePreviews.copy': 'Copy preview link',
        'interactivePreviews.expiresAt': 'Expires at',
        'interactivePreviews.provider': 'Vercel',
    })[key] ?? key,
}));
vi.mock('react-native-unistyles', async () => {
    const { appThemes } = await vi.importActual<typeof import('@/themePacks')>('@/themePacks');
    mocks.themes = appThemes;
    mocks.theme = appThemes.caramelLight;
    return { StyleSheet: { create: (factory: (theme: any) => object) => factory(mocks.theme) }, useUnistyles: () => ({ theme: mocks.theme }) };
});

function preview(state: 'publishing' | 'ready' | 'failed' | 'expired', url?: string) {
    return {
        name: 'interactive-preview',
        state: state === 'failed' ? 'error' : 'completed',
        input: {
            version: 1,
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Toolbar study',
            state,
            ...(url ? { url } : {}),
            expiresAt: Date.now() + 60_000,
        },
    } as any;
}

describe('InteractivePreviewCard', () => {
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.clearAllMocks();
    });

    it.each([
        ['publishing', 'Publishing preview…'],
        ['ready', 'Preview ready'],
        ['failed', 'Preview publishing failed'],
        ['expired', 'Preview expired and removed'],
    ] as const)('projects %s as a display-only card', (state, label) => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<InteractivePreviewCard tool={preview(state, state === 'ready' ? 'https://draft.example' : undefined)} metadata={null} messages={[]} />); });

        const card = renderer.root.findByProps({ testID: 'interactive-preview-card' });
        expect(card.findAllByType('Text').map((node: any) => node.children.join(''))).toContain(label);
        expect(card.findAllByType('Text').map((node: any) => node.children.join(''))).toContain('Vercel');
        expect(card.findAllByType('iframe')).toHaveLength(0);
        expect(card.findAllByType('WebView')).toHaveLength(0);
        expect(card.findAllByType('TextInput')).toHaveLength(0);
        expect(card.findAllByProps({ testID: 'interactive-preview-open' })).toHaveLength(state === 'ready' ? 1 : 0);
        act(() => renderer.unmount());
    });

    it('opens and copies only a validated HTTP(S) preview URL', async () => {
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<InteractivePreviewCard tool={preview('ready', 'https://draft.example/path')} metadata={null} messages={[]} />); });

        await act(async () => { renderer.root.findByProps({ testID: 'interactive-preview-open' }).props.onPress(); });
        await act(async () => { renderer.root.findByProps({ testID: 'interactive-preview-copy' }).props.onPress(); });
        expect(mocks.open).toHaveBeenCalledWith('https://draft.example/path');
        expect(mocks.copy).toHaveBeenCalledWith('https://draft.example/path');
        act(() => renderer.unmount());
    });

    it('fails closed for unsafe URL schemes instead of rendering actions', () => {
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<InteractivePreviewCard tool={preview('ready', 'javascript:alert(1)')} metadata={null} messages={[]} />); });

        expect(renderer.root.findAllByProps({ testID: 'interactive-preview-open' })).toHaveLength(0);
        expect(renderer.root.findAllByProps({ testID: 'interactive-preview-copy' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('keeps the semantic primary background in default light and gingham dark pressed states', () => {
        for (const name of ['caramelLight', 'ginghamDark'] as const) {
            mocks.theme = mocks.themes[name];
            const background = mocks.theme.colors.button.primary.background;
            let renderer: any;
            act(() => { renderer = TestRenderer.create(<InteractivePreviewCard tool={preview('ready', 'https://draft.example')} metadata={null} messages={[]} />); });
            const style = renderer.root.findByProps({ testID: 'interactive-preview-open' }).props.style;
            expect(style({ pressed: false })).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: background, opacity: 1 })]));
            expect(style({ pressed: true })).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: background, opacity: expect.any(Number) })]));
            act(() => renderer.unmount());
        }
    });
});
