import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer is only used by this component harness.
import TestRenderer from 'react-test-renderer';

vi.mock('react-native', () => ({
    Modal: 'Modal',
    Platform: { OS: 'android' },
    Pressable: 'Pressable',
    Text: 'Text',
    View: 'View',
}));
vi.mock('react-native-webview', () => ({ WebView: 'WebView' }));
vi.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
vi.mock('react-native-unistyles', () => {
    const theme = {
        dark: false,
        colors: {
            divider: '#d8ddd8',
            surface: '#ffffff',
            surfaceHigh: '#f6f8f6',
            surfaceHighest: '#e2eadf',
            surfacePressed: '#d4ddd1',
            text: '#1f2a22',
            textSecondary: '#708075',
        },
    };
    return {
        StyleSheet: {
            absoluteFillObject: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
            create: (factory: any) => factory(theme),
            hairlineWidth: 1,
        },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { MermaidRenderer } from './MermaidRenderer';

describe('MermaidRenderer native document', () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        act(() => renderer?.unmount());
        renderer = undefined;
        vi.restoreAllMocks();
    });

    it('does not let a blocking CDN script prevent the native error boundary from starting', () => {
        act(() => {
            renderer = TestRenderer.create(<MermaidRenderer content="flowchart LR\nA --> B" />);
        });

        const html = renderer!.root.findByType('WebView').props.source.html as string;

        expect(html).not.toMatch(/<script\s+src=/i);
        expect(html).toContain('setTimeout');
        expect(html).toContain("post({ type: 'error' })");
    });
});
