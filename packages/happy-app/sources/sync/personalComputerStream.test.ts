import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import TestRenderer from 'react-test-renderer';
import { personalComputerStream, usePersonalComputerFrame, usePersonalComputerInterrupted } from './personalComputerStream';

function frame(viewerId = 'viewer-a', epoch = 2, sequence = 1) {
    return { type: 'personal-computer-frame' as const, viewerId, epoch, sequence, data: 'YWJj', width: 1280, height: 720 };
}
let observed: { frame: ReturnType<typeof usePersonalComputerFrame>; interrupted: boolean };
function Probe() {
    observed = { frame: usePersonalComputerFrame('session-a', 'viewer-a'), interrupted: usePersonalComputerInterrupted() };
    return null;
}
let tree: any;
describe('Personal computer transient frame stream', () => {
    beforeEach(async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        personalComputerStream.open('session-a', 'viewer-a');
        await act(async () => { tree = TestRenderer.create(React.createElement(Probe)); });
    });
    afterEach(async () => { await act(async () => { tree.unmount(); }); personalComputerStream.close('viewer-a'); });

    it('rejects frames for a different session or viewer and malformed payloads', async () => {
        await act(async () => {
            personalComputerStream.receive('session-b', frame());
            personalComputerStream.receive('session-a', frame('viewer-b'));
            personalComputerStream.receive('session-a', { ...frame(), data: 'not base64!' });
        });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.receive('session-a', frame()); });
        expect(observed.frame).toEqual(frame());
    });

    it('cannot roll the epoch backwards or accept a stale frame after a takeover', async () => {
        await act(async () => { personalComputerStream.receive('session-a', frame()); });
        await act(async () => { personalComputerStream.epoch('viewer-a', 5); });
        expect(observed.frame).toBeNull();
        await act(async () => {
            personalComputerStream.epoch('viewer-b', 99);
            personalComputerStream.epoch('viewer-a', 1);
            personalComputerStream.receive('session-a', frame('viewer-a', 4, 99));
        });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 5, 1)); });
        expect(observed.frame?.epoch).toBe(5);
    });

    it('keeps the newest sequence within an epoch and allows a fresh sequence after an epoch advance', async () => {
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 2, 4)); });
        await act(async () => {
            personalComputerStream.receive('session-a', frame('viewer-a', 2, 3));
            personalComputerStream.receive('session-a', { ...frame('viewer-a', 2, 4), data: 'ZGVm' });
        });
        expect(observed.frame).toEqual(frame('viewer-a', 2, 4));
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 3, 0)); });
        expect(observed.frame).toEqual(frame('viewer-a', 3, 0));
    });

    it('retains the highest acknowledged epoch when the same viewer reopens its stream', async () => {
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 8, 2)); });
        await act(async () => { personalComputerStream.open('session-a', 'viewer-a', 3); });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 7, 99)); });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 8, 3)); });
        expect(observed.frame).toEqual(frame('viewer-a', 8, 3));
        await act(async () => { personalComputerStream.interrupt(); personalComputerStream.open('session-a', 'viewer-a'); });
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 7, 100)); });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 9, 1)); });
        expect(observed.frame).toEqual(frame('viewer-a', 9, 1));
    });

    it('changes the viewer generation on open, interrupt and owner close, but not for an unrelated close', async () => {
        const opened = personalComputerStream.generation();
        await act(async () => { personalComputerStream.epoch('viewer-a', 3); personalComputerStream.receive('session-a', frame('viewer-a', 3, 1)); });
        expect(personalComputerStream.generation()).toBe(opened);
        await act(async () => { personalComputerStream.interrupt(); });
        const interrupted = personalComputerStream.generation();
        expect(interrupted).toBeGreaterThan(opened);
        await act(async () => { personalComputerStream.open('session-a', 'viewer-a', 3); });
        const reopened = personalComputerStream.generation();
        expect(reopened).toBeGreaterThan(interrupted);
        expect(reopened).not.toBe(opened);
        await act(async () => { personalComputerStream.close('other-viewer'); });
        expect(personalComputerStream.generation()).toBe(reopened);
        await act(async () => { personalComputerStream.close('viewer-a'); });
        expect(personalComputerStream.generation()).toBeGreaterThan(reopened);
    });

    it('keeps the sequence watermark across same-epoch reopen and disconnect so an old frame cannot return', async () => {
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 2, 7)); });
        await act(async () => { personalComputerStream.open('session-a', 'viewer-a', 2); });
        expect(observed.frame).toBeNull();
        await act(async () => {
            personalComputerStream.receive('session-a', frame('viewer-a', 2, 6));
            personalComputerStream.receive('session-a', { ...frame('viewer-a', 2, 7), data: 'ZGVm' });
        });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 2, 8)); });
        expect(observed.frame).toEqual(frame('viewer-a', 2, 8));
        await act(async () => { personalComputerStream.interrupt(); personalComputerStream.open('session-a', 'viewer-a'); });
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 2, 7)); });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 2, 9)); });
        expect(observed.frame).toEqual(frame('viewer-a', 2, 9));
    });

    it('clears the frame on disconnect and drops even newer frames until an explicit new view opens', async () => {
        await act(async () => { personalComputerStream.receive('session-a', frame()); });
        await act(async () => { personalComputerStream.interrupt(); });
        expect(observed).toEqual({ frame: null, interrupted: true });
        await act(async () => { personalComputerStream.receive('session-a', frame('viewer-a', 99, 99)); });
        expect(observed.frame).toBeNull();
        await act(async () => { personalComputerStream.open('session-a', 'viewer-a'); personalComputerStream.receive('session-a', frame('viewer-a', 3, 1)); });
        expect(observed).toEqual({ frame: frame('viewer-a', 3, 1), interrupted: false });
    });

    it('ignores another viewer closing and removes frame memory when the owning viewer closes', async () => {
        await act(async () => { personalComputerStream.receive('session-a', frame()); personalComputerStream.close('viewer-b'); });
        expect(observed.frame).toEqual(frame());
        await act(async () => { personalComputerStream.close('viewer-a'); personalComputerStream.receive('session-a', frame('viewer-a', 2, 2)); });
        expect(observed.frame).toBeNull();
    });
});
