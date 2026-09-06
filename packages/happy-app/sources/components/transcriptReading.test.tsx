import * as React from 'react';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error no local declarations
import TestRenderer from 'react-test-renderer';
import { expandedGroupKeys, groupIsExpanded, findAnchorIndex, useTranscriptReading, TranscriptReadingMarker, TranscriptReadingContext } from './transcriptReading';
vi.mock('react-native', () => ({ View: 'View' }));
const msg = (id: string) => ({ id, kind: 'agent-text', text: id, createdAt: 1, localId: null }) as any;
const group = (id: string, ids: string[]) => ({ type: 'tool-group', id, messages: ids.map(msg), hasRunning: false, hasPendingPermission: false }) as any;
const wire = (id: string) => id.replace(/-replayed$/, '');

describe('durable transcript reading anchors', () => {
    it('keeps group expansion when replay or an older boundary changes its rendered group ID', () => {
        const saved = expandedGroupKeys([group('old-group', ['wire2'])], new Set(), wire);
        expect(saved).toEqual([JSON.stringify(['tool-group', 'wire2'])]);
        expect(groupIsExpanded(group('new-group', ['wire1-replayed', 'wire2-replayed']), saved, wire)).toBe(true);
        expect(findAnchorIndex([group('new-group', ['wire1-replayed', 'wire2-replayed'])], 'wire2', wire)).toBe(0);
        const stable = (id: string) => id === 'synthetic-permission' ? null : 'one-wire-multiple-blocks';
        expect(findAnchorIndex([group('synthetic', ['synthetic-permission']), group('real', ['block1', 'block2'])], 'one-wire-multiple-blocks', stable)).toBe(1);
    });

    it('restores using measured row coordinates and persists the stable wire anchor with its signed viewport offset', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const saved = { version: 1, anchorId: 'wire2', anchorSeq: 2, offset: -30, expandedGroupIds: [], followLatest: false } as const;
        const save = vi.fn(); const scrollToOffset = vi.fn(); const scrollToIndex = vi.fn();
        let reading: any;
        const adapter = { key: 'account/session', read: async () => ({ ...saved, expandedGroupIds: [] }), save,
            wireId: wire, wireSeq: () => 2 };
        const list = { current: { scrollToOffset, scrollToIndex } };
        const viewport = { current: { measureInWindow: (cb: any) => cb(0, 100, 800, 600) } };
        let items = [{ type: 'message', id: 'wire2-replayed', message: msg('wire2-replayed') }] as any;
        let rowY = 150;
        function Probe(_props: { revision?: number }) {
            reading = useTranscriptReading({ adapter, items, inverted: true, isAtLatest: false, listRef: list as any,
                viewportRef: viewport as any, expanded: [], restoreExpanded: () => {} });
            return <TranscriptReadingContext.Provider value={reading.markers}>
                <TranscriptReadingMarker messageId="wire2-replayed"><></></TranscriptReadingMarker>
            </TranscriptReadingContext.Provider>;
        }
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<Probe />, {
            createNodeMock: () => ({ measureInWindow: (cb: any) => cb(0, rowY, 800, 200) }),
        }); });
        await act(async () => { reading.scroll(400, 500); await reading.layout(); });
        // Current y 150 should become viewport y 100 - 30. Inverted offset
        // increases move the item down, so the measured correction is -80.
        expect(scrollToOffset).toHaveBeenCalledWith({ offset: 320, animated: false });
        await act(async () => { reading.scroll(400, 500); await reading.capture(); });
        // Reprojection/prepend moves the same wire-backed row by 100px.
        rowY = 250;
        items = [...items, { type: 'message', id: 'older', message: msg('older') }];
        await act(async () => { renderer.update(<Probe revision={1} />); });
        expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 300, animated: false });
        act(() => renderer.unmount());
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ anchorId: 'wire2', anchorSeq: 2, offset: 50, followLatest: false }));
        delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    });

    it('discards an old account reading-state load after the component changes owners', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        let finish!: (value: any) => void;
        const restored = vi.fn();
        const ownerA = { key: 'a', read: () => new Promise<any>(resolve => { finish = resolve; }), save: vi.fn(), wireId: wire, wireSeq: () => 1 };
        const ownerB = { ...ownerA, key: 'b', read: async () => null, save: vi.fn() };
        const empty = { current: null };
        function Probe(props: { adapter: any }) {
            useTranscriptReading({ adapter: props.adapter, items: [], inverted: true, isAtLatest: false,
                listRef: empty, viewportRef: empty, expanded: [], restoreExpanded: restored });
            return null;
        }
        let renderer: any;
        await act(async () => { renderer = TestRenderer.create(<Probe adapter={ownerA} />); });
        await act(async () => { renderer.update(<Probe adapter={ownerB} />); });
        restored.mockClear();
        await act(async () => { finish({ version: 1, anchorId: 'secret-a', anchorSeq: 1, offset: 0, expandedGroupIds: ['a'] }); });
        expect(restored).not.toHaveBeenCalled();
        expect(ownerA.save).not.toHaveBeenCalled(); expect(ownerB.save).not.toHaveBeenCalled();
        act(() => renderer.unmount()); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    });
});
