import { create } from 'zustand';
import { PersonalComputerFrameSchema, type PersonalComputerFrame } from '@slopus/happy-wire';

type LiveComputer = { sessionId: string | null; viewerId: string | null; epoch: number; sequence: number; frame: PersonalComputerFrame | null; interrupted: boolean };
const live = create<LiveComputer>(() => ({ sessionId: null, viewerId: null, epoch: 0, sequence: -1, frame: null, interrupted: false }));
let generation = 0;

/** One visible computer, no disk persistence, replay queue or polling. */
export const personalComputerStream = {
    generation: () => generation,
    open(sessionId: string, viewerId: string, epoch = 0) {
        generation++;
        const current = live.getState();
        const sameViewer = current.sessionId === sessionId && current.viewerId === viewerId;
        const nextEpoch = sameViewer ? Math.max(epoch, current.epoch) : epoch;
        live.setState({ sessionId, viewerId, epoch: nextEpoch, sequence: sameViewer && nextEpoch === current.epoch ? current.sequence : -1, frame: null, interrupted: false });
    },
    close(viewerId: string) { if (live.getState().viewerId === viewerId) { generation++; live.setState({ sessionId: null, viewerId: null, frame: null, interrupted: false }); } },
    epoch(viewerId: string, epoch: number) {
        const state = live.getState();
        if (state.viewerId === viewerId && epoch >= state.epoch) live.setState({ epoch, sequence: epoch === state.epoch ? state.sequence : -1, frame: state.frame?.epoch === epoch ? state.frame : null });
    },
    receive(sessionId: string, value: unknown) {
        const parsed = PersonalComputerFrameSchema.safeParse(value), state = live.getState();
        if (!parsed.success || state.interrupted || state.sessionId !== sessionId || state.viewerId !== parsed.data.viewerId || parsed.data.epoch < state.epoch) return;
        if (state.epoch === parsed.data.epoch && state.sequence >= parsed.data.sequence) return;
        live.setState({ epoch: parsed.data.epoch, sequence: parsed.data.sequence, frame: parsed.data });
    },
    interrupt() { generation++; live.setState({ frame: null, interrupted: true }); },
};
export const usePersonalComputerFrame = (sessionId: string, viewerId: string) => live(state =>
    state.sessionId === sessionId && state.viewerId === viewerId ? state.frame : null);
export const usePersonalComputerInterrupted = () => live(state => state.interrupted);
