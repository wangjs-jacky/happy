import * as React from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { BrowserStepsPopover } from './BrowserStepsPopover';

vi.mock('react-native', () => ({ Platform: { OS: 'web' }, Pressable: 'Pressable', Text: 'Text', View: 'View' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { absoluteFillObject: {}, hairlineWidth: 1, create: (value: any) => typeof value === 'function' ? value() : value },
    useUnistyles: () => ({ theme: { colors: { surface: '#fff', divider: '#ddd', text: '#111', textSecondary: '#666' } } }),
}));
vi.mock('./BrowserStepsPanel', () => ({ BrowserStepsPanel: 'BrowserStepsPanel' }));

describe('BrowserStepsPopover', () => {
    it('is opt-in and closes through the explicit close action', async () => {
        const onClose = vi.fn(); let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<BrowserStepsPopover open={false} onClose={onClose} sessionId="s1" steps={[]} />); });
        expect(renderer.toJSON()).toBeNull();
        await act(async () => { renderer.update(<BrowserStepsPopover open onClose={onClose} sessionId="s1" steps={[]} />); });
        expect(renderer.root.findAllByProps({ testID: 'browser-steps-popover' })).toHaveLength(1);
        await act(async () => { renderer.root.findByProps({ accessibilityLabel: 'Close browser progress' }).props.onPress(); });
        expect(onClose).toHaveBeenCalledOnce();
    });
});
