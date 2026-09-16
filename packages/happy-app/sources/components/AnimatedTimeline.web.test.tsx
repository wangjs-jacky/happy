import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { AnimatedTimelineProvider, AnimatedTimelineItem } from './AnimatedTimeline.web';

const state = vi.hoisted(() => ({ inView: false, reduced: false }));
vi.mock('motion/react', () => ({
    motion: { div: 'motion-div' },
    useInView: () => state.inView,
    useReducedMotion: () => state.reduced,
}));
vi.mock('react-native-unistyles', () => ({ useUnistyles: () => ({ theme: { colors: {
    surfaceSelected: 'selected', surfacePressed: 'hover', groupped: { background: 'normal' }, divider: 'border', accent: 'accent',
} } }) }));

function Fixture({ show = true, active = false, hovered = false }) {
    return <AnimatedTimelineProvider>{show && <AnimatedTimelineItem enabled sessionId="a" active={active} hovered={hovered}><button>Session title</button></AnimatedTimelineItem>}</AnimatedTimelineProvider>;
}
const row = (r: any) => r.root.findByProps({ 'data-testid': 'animated-timeline-a' });
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    state.inView = false;
    state.reduced = false;
});

describe('virtualized Animated List motion', () => {
    it('remembers a visible session across virtual unmounts and does not animate it in again', () => {
        let r: any;
        act(() => { r = TestRenderer.create(<Fixture />); });
        expect(row(r).props.animate.opacity).toBe(0);
        state.inView = true;
        act(() => r.update(<Fixture hovered />));
        expect(row(r).props.animate.opacity).toBe(1);
        act(() => r.update(<Fixture show={false} />));
        state.inView = false;
        act(() => r.update(<Fixture />));
        expect(row(r).props.initial).toBe(false);
        expect(row(r).props.animate.opacity).toBe(1);
        act(() => r.unmount());
    });

    it('keeps hover distinct from selection, leaves input handling to the existing row', () => {
        state.inView = true;
        let r: any;
        act(() => { r = TestRenderer.create(<Fixture hovered />); });
        expect(row(r).props.animate.backgroundColor).toBe('hover');
        expect(row(r).props.onMouseEnter).toBeUndefined();
        expect(row(r).props.onKeyDown).toBeUndefined();
        act(() => r.update(<Fixture active hovered />));
        expect(row(r).props.animate.backgroundColor).toBe('selected');
        act(() => r.unmount());
    });

    it('renders immediately without motion when reduced motion is requested', () => {
        state.reduced = true;
        let r: any;
        act(() => { r = TestRenderer.create(<Fixture />); });
        expect(row(r).props.initial).toBe(false);
        expect(row(r).props.animate).toMatchObject({ opacity: 1, y: 0 });
        expect(row(r).props.transition.duration).toBe(0);
        act(() => r.unmount());
    });
});
