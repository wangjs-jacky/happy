import * as React from 'react';
import { act } from 'react';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
// @ts-expect-error no local renderer declarations
import TestRenderer from 'react-test-renderer';
import { createAnchoredWebVirtualizedList } from './anchoredWebVirtualizedList';

const require = createRequire(import.meta.url);
// Same explicit Web export as production (bypasses Unistyles' RN wrapper).
const VendorList = require('react-native-web/dist/cjs/exports/VirtualizedList');
const List = createAnchoredWebVirtualizedList(VendorList);
let transformedEntry: string;
// Babel/plugin cold loading is suite setup, not part of a 5s behavior test.
beforeAll(() => {
    const babel = require('@babel/core');
    const filename = fileURLToPath(new URL('./TranscriptList.web.tsx', import.meta.url));
    transformedEntry = babel.transformFileSync(filename, { cwd: process.cwd(),
        caller: { name: 'metro', platform: 'web', supportsStaticESM: false } }).code;
}, 30000);
const props = (data: number[]) => ({ data, getItem: (rows: number[], index: number) => rows[index],
    getItemCount: (rows: number[]) => rows.length, keyExtractor: (row: number) => `wire-${row}`,
    getItemLayout: (_: unknown, index: number) => ({ index, offset: index * 100, length: 100 }),
    initialNumToRender: 10, windowSize: 5, maxToRenderPerBatch: 10,
});
afterEach(() => { vi.restoreAllMocks(); });

it('keeps a visible loaded image mounted through prepend and corrects offset before paint with bounded cells', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const unmount = vi.fn();
    const Row = ({ id }: { id: number }) => {
        React.useEffect(() => () => { unmount(id); }, [id]);
        return <img data-row={id} src={`image-${id}`} />;
    };
    let list: any; let renderer: any;
    const offsetChanged = vi.fn();
    const render = (data: number[], growth = 0) => <List {...props(data)} ref={(value: any) => { list = value; }}
        onAnchorOffsetChange={offsetChanged}
        getItemLayout={(_: unknown, index: number) => ({ index, offset: index * 100 + (data[index] >= 544 ? growth : 0),
            length: 100 + (data[index] === 543 ? growth : 0) })}
        renderItem={({ item }: { item: number }) => <Row id={item} />} />;
    await act(async () => { renderer = TestRenderer.create(render(Array.from({ length: 67 }, (_, i) => 534 + i))); });
    const node = { scrollTop: 1000, addEventListener() {}, removeEventListener() {} };
    const scrollTo = vi.fn(({ y }: { y: number }) => { node.scrollTop = y; });
    list._scrollRef = { scrollTo, getScrollableNode: () => node };
    list._scrollMetrics = { ...list._scrollMetrics, offset: 1000, visibleLength: 600, contentLength: 6700 };
    // Use the real vendor mask/state and render cells, not a mocked FlatList.
    await act(async () => { list.setState({ cellsAroundViewport: { first: 8, last: 18 },
        renderMask: VendorList._createRenderMask(list.props, { first: 8, last: 18 }) }); });
    const image = renderer.root.findByProps({ 'data-row': 544 });
    unmount.mockClear(); scrollTo.mockClear();
    await act(async () => { renderer.update(render(Array.from({ length: 366 }, (_, i) => 235 + i))); });
    try {
        expect(unmount.mock.calls.flat()).not.toContain(544);
        expect(renderer.root.findByProps({ 'data-row': 544 })).toBe(image);
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 30900, animated: false }));
        expect(offsetChanged).toHaveBeenLastCalledWith(30900);
        // A late image/layout measurement above the visible anchor must not
        // wait for asynchronous reading-marker correction to converge.
        scrollTo.mockClear();
        await act(async () => { renderer.update(render(Array.from({ length: 366 }, (_, i) => 235 + i), 147)); });
        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 31047, animated: false }));
        expect(unmount.mock.calls.flat()).not.toContain(544);
        expect(renderer.root.findByProps({ 'data-row': 544 })).toBe(image);
        expect(renderer.root.findAllByType('img').length).toBeLessThan(80);
    } finally { act(() => renderer.unmount()); }
});

it('rejects unsupported virtualizer internals instead of rendering the entire history', () => {
    expect(() => createAnchoredWebVirtualizedList(class {})).toThrow('Unsupported Web transcript virtualizer');
});

it.each([false, true])('uses committed DOM displacement instead of estimated prefix or duplicate browser anchoring (browser: %s)', async browserAnchored => {
    let list: any; let renderer: any; let rowTop = 100;
    const anchor = { isConnected: true, getBoundingClientRect: () => ({ top: rowTop, bottom: rowTop + 100 }) };
    const node = { scrollTop: 100, getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
        querySelectorAll: () => [anchor], addEventListener() {}, removeEventListener() {} };
    const Row = ({ phase }: { phase: number }) => {
        React.useLayoutEffect(() => {
            if (phase === 1) { rowTop = browserAnchored ? 100 : 140; if (browserAnchored) node.scrollTop = 140; }
        }, [phase]);
        return <img data-transcript-key="anchor" />;
    };
    const render = (phase: number) => <List {...props(phase ? [0, 1] : [1])} ref={(value: any) => { list = value; }}
        getItemLayout={(_: unknown, index: number) => ({ index, offset: index * (phase === 2 ? 190 : 200), length: 200 })}
        renderItem={({ item }: { item: number }) => item === 1 ? <Row phase={phase} /> : <span />} />;
    await act(async () => { renderer = TestRenderer.create(render(0)); });
    list._scrollMetrics = { ...list._scrollMetrics, offset: 100, visibleLength: 600, contentLength: 1000 };
    list._scrollRef = { getScrollableNode: () => node, scrollTo: ({ y }: { y: number }) => {
        rowTop -= y - node.scrollTop; node.scrollTop = y;
    } };
    try {
        await act(async () => { renderer.update(render(1)); });
        expect(node.scrollTop).toBe(140);
        expect(rowTop).toBe(100);
        // Measured prefix estimates change while actual DOM stays unchanged.
        await act(async () => { renderer.update(render(2)); });
        expect(node.scrollTop).toBe(140);
        expect(rowTop).toBe(100);
    } finally { act(() => renderer.unmount()); }
});

it('initializes the actual Web entry after the app Babel/Unistyles transform', () => {
    const module = { exports: {} as any };
    const runtimeRequire = (id: string) => {
        if (id === './anchoredWebVirtualizedList') return { createAnchoredWebVirtualizedList };
        if (id === 'react-native-web/dist/exports/VirtualizedList') return VendorList;
        // Model the exact boundary that failed in Metro: Unistyles emits a
        // functional wrapper, not the class whose private statics are required.
        if (id.includes('unistyles') && id.includes('VirtualizedList')) return { VirtualizedList: () => null };
        return require(id);
    };
    new Function('require', 'module', 'exports', transformedEntry)(runtimeRequire, module, module.exports);
    expect(module.exports.TranscriptList.render({ data: [], getItemLayout: () => ({ index: 0, offset: 0, length: 100 }) }, null).type.name)
        .toBe('AnchoredWebVirtualizedList');
});
