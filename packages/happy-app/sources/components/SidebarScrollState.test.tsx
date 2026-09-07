import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { SidebarScrollProvider, useSidebarScrollState } from './SidebarScrollState';

describe('sidebar scroll memory', () => {
    let current: ReturnType<typeof useSidebarScrollState<string>>;
    let renderer: any;
    const scrollToOffset = vi.fn();
    function List({ view }: { view: string }) {
        current = useSidebarScrollState<string>(view);
        return React.createElement('FlatList', { ...current });
    }
    const tree = (view: string, workspace = 'first') => <SidebarScrollProvider key={workspace}><List key={view} view={view} /></SidebarScrollProvider>;
    const event = (offset: number) => ({ nativeEvent: { contentOffset: { y: offset } } }) as any;
    const size = (height = 2000) => {
        current.onLayout({ nativeEvent: { layout: { height: 400 } } } as any);
        current.onContentSizeChange(300, height);
    };
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        scrollToOffset.mockClear();
        act(() => { renderer = TestRenderer.create(tree('projects'), { createNodeMock: () => ({ scrollToOffset }) }); });
    });
    afterEach(() => { act(() => renderer.unmount()); });

    it('restores each tab independently and ignores mount-time zero scroll events', () => {
        size();
        current.onScroll(event(600));
        act(() => renderer.update(tree('lists')));
        size();
        current.onScroll(event(120));
        act(() => renderer.update(tree('projects')));
        current.onScroll(event(0));
        size();
        expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 600, animated: false });
        current.onScroll(event(600));
        act(() => renderer.update(tree('lists')));
        size();
        expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 120, animated: false });
    });

    it('lets a user drag cancel restoration', () => {
        current.onScroll(event(600));
        act(() => renderer.update(tree('lists')));
        act(() => renderer.update(tree('projects')));
        current.onScrollBeginDrag();
        current.onScroll(event(80));
        size();
        expect(scrollToOffset).not.toHaveBeenCalled();
        act(() => renderer.update(tree('lists')));
        act(() => renderer.update(tree('projects')));
        size();
        expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 80, animated: false });
    });

    it('discards previous account positions when the workspace unmounts', () => {
        current.onScroll(event(600));
        act(() => renderer.update(tree('projects', 'next-account')));
        size();
        expect(scrollToOffset).not.toHaveBeenCalled();
    });
});
