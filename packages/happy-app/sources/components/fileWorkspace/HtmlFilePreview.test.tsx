import * as React from 'react';
import { act } from 'react';
// @ts-expect-error react-test-renderer has no declarations.
import TestRenderer from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ View: 'View', ActivityIndicator: 'ActivityIndicator' }));
vi.mock('@/components/StyledText', () => ({ Text: 'Text' }));
vi.mock('react-native-unistyles', () => ({ useUnistyles: () => ({ theme: { colors: {} } }) }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./fileIO', () => ({ readWorkspaceBytes: vi.fn() }));
vi.mock('./WorkspaceButton', () => ({ WorkspaceButton: 'WorkspaceButton' }));
vi.mock('./htmlPreviewBundle', () => ({ buildHtmlFilePreview: async () => ({ html: '<h1>preview</h1>', dispose: vi.fn() }) }));
import { HtmlFilePreview } from './HtmlFilePreview.web';
it('requires an explicit interaction action before allowing artifact scripts, and resets on another file', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(<HtmlFilePreview key="a" sessionId="s" path="/work/a.html" root="/work" content="<h1>preview</h1>" />); });
    expect(renderer.root.findByType('iframe').props.sandbox).toBe('');
    await act(async () => { renderer.root.findByType('WorkspaceButton').props.onPress(); });
    expect(renderer.root.findByType('iframe').props.sandbox).toBe('allow-scripts');
    await act(async () => { renderer.update(<HtmlFilePreview key="b" sessionId="s" path="/work/b.html" root="/work" content="<h1>preview</h1>" />); });
    expect(renderer.root.findByType('iframe').props.sandbox).toBe('');
    await act(async () => { renderer.unmount(); });
});
