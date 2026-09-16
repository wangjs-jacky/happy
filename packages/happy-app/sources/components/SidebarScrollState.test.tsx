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

    it('waits for virtualized content to reach the saved offset instead of saving the initial clamp', () => {
        size();
        current.onScroll(event(1300));
        act(() => renderer.update(tree('lists')));
        act(() => renderer.update(tree('projects')));
        size(600);
        current.onScroll(event(200));
        scrollToOffset.mockClear();
        current.onContentSizeChange(300, 2400);
        expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 1300, animated: false });
        current.onScroll(event(1300));
        act(() => renderer.update(tree('lists')));
        act(() => renderer.update(tree('projects')));
        size(2400);
        expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 1300, animated: false });
    });

    it('ignores queued scroll events from the previous tab after unmount', () => {
        size();
        current.onScroll(event(900));
        const previous = current;
        act(() => renderer.update(tree('lists')));
        previous.onScroll(event(0));
        act(() => renderer.update(tree('projects')));
        size();
        expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 900, animated: false });
    });

    it('lets the wheel take over when the saved offset exceeds the remaining content', () => {
        size();
        current.onScroll(event(1300));
        act(() => renderer.update(tree('lists')));
        act(() => renderer.update(tree('projects')));
        size(600);
        current.onScroll(event(200));
        current.onWheel();
        current.onScroll(event(100));
        scrollToOffset.mockClear();
        current.onContentSizeChange(300, 800);
        expect(scrollToOffset).not.toHaveBeenCalled();
    });

    it('lets keyboard scrolling replace an unreachable saved offset', () => {
        size();
        current.onScroll(event(1300));
        act(() => renderer.update(tree('lists')));
        act(() => renderer.update(tree('projects')));
        size(600);
        current.onScroll(event(200));
        current.onKeyDown({ key: 'Home' });
        current.onScroll(event(0));
        scrollToOffset.mockClear();
        current.onContentSizeChange(300, 2400);
        expect(scrollToOffset).not.toHaveBeenCalled();
        act(() => renderer.update(tree('lists')));
        act(() => renderer.update(tree('projects')));
        size();
        expect(scrollToOffset).not.toHaveBeenCalled();
    });

    it('ignores old measurement callbacks when the same list instance changes modes', () => {
        const stableTree = (view: string) => <SidebarScrollProvider><List view={view} /></SidebarScrollProvider>;
        act(() => renderer.update(stableTree('projects')));
        size();
        current.onScroll(event(900));
        act(() => renderer.update(stableTree('lists')));
        act(() => renderer.update(stableTree('projects')));
        const previous = current;
        act(() => renderer.update(stableTree('lists')));
        scrollToOffset.mockClear();
        previous.onLayout({ nativeEvent: { layout: { height: 400 } } } as any);
        previous.onContentSizeChange(300, 2400);
        expect(scrollToOffset).not.toHaveBeenCalled();
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
