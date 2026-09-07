// @vitest-environment jsdom

import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    // react-native-web does not publish TypeScript declarations.
    // @ts-expect-error The test intentionally exercises its DOM runtime.
    return import('react-native-web');
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-native-unistyles', () => ({
    StyleSheet: {
        absoluteFillObject: {},
        hairlineWidth: 1,
        create: (factory: any) => factory({ colors: {
            divider: '#ddd', shadow: { color: '#000', opacity: 0.2 }, surface: '#fff',
            surfacePressed: '#eee', text: '#111', textSecondary: '#666',
        } }),
    },
    useUnistyles: () => ({ theme: { colors: {
        divider: '#ddd', shadow: { color: '#000', opacity: 0.2 }, surface: '#fff',
        surfacePressed: '#eee', text: '#111', textSecondary: '#666',
    } } }),
}));
vi.mock('@/text', () => ({ t: (key: string) => key.endsWith('.title') ? 'Browser progress' : 'Close browser progress' }));
vi.mock('./BrowserStepsPanel', () => ({ BrowserStepsPanel: () => <div>steps</div> }));
vi.mock('../SessionImageViewer', () => ({ SessionImageViewer: () => null }));
vi.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'div' }));
vi.mock('@/sync/storage', () => ({ storage: { getState: () => ({ sessionMessages: {} }) } }));

import { BrowserStepsPopover } from './BrowserStepsPopover';

describe('BrowserStepsPopover web dialog semantics', () => {
    let root: Root;
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('renders exactly one named modal dialog and no duplicate inner dialog owner', async () => {
        const onClose = vi.fn();
        await act(async () => {
            root.render(<BrowserStepsPopover open onClose={onClose} sessionId="s1" steps={[]} />);
        });

        const modalRoot = document.querySelector<HTMLElement>('[aria-modal="true"][aria-label="Browser progress"]');
        expect(modalRoot).not.toBeNull();
        const dialogs = document.querySelectorAll('[role="dialog"][aria-label="Browser progress"]');
        expect(dialogs).toHaveLength(1);
        expect(dialogs[0]?.getAttribute('aria-modal')).toBe('true');
        const inner = document.querySelector('[data-testid="browser-steps-popover"]');
        expect(inner?.getAttribute('role')).toBeNull();
        expect(inner?.getAttribute('aria-modal')).toBeNull();
        expect(inner?.getAttribute('aria-label')).toBeNull();

        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
