import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { BrowserStepsPanel } from './BrowserStepsPanel';

vi.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    View: 'View',
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { create: (value: any) => typeof value === 'function' ? value() : value },
    useUnistyles: () => ({ theme: { colors: { divider: '#ddd', surface: '#fff', surfaceHigh: '#f4f4f4', surfaceSelected: '#eee', text: '#111', textSecondary: '#666' } } }),
}));
vi.mock('@/hooks/useAttachmentImage', () => ({ useAttachmentImage: () => ({ loading: false, uri: null }) }));

describe('BrowserStepsPanel', () => {
    let renderer: any;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    const originalConsoleError = console.error;

    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => {
        if (renderer) act(() => renderer.unmount());
        renderer = undefined;
        consoleErrorSpy.mockRestore();
    });

    it('keeps a long timeline inside its bounded scroll container', () => {
        const steps = Array.from({ length: 20 }, (_, index) => ({
            createdAt: index + 1,
            id: `step-${index + 1}`,
            label: `Step ${index + 1}`,
            name: `step-${index + 1}.png`,
            ref: `attachment://step-${index + 1}`,
        }));
        act(() => {
            renderer = TestRenderer.create(<BrowserStepsPanel sessionId="s1" steps={steps} />);
        });

        const scroll = renderer.root.findByProps({ testID: 'browser-steps-timeline-scroll' });
        expect(scroll.props.style).toEqual(expect.objectContaining({ flex: 1, minHeight: 0 }));
        expect(renderer.root.findAllByType('Pressable')).toHaveLength(20);
    });
});
