import { describe, expect, it } from 'vitest';
import { SessionMessageLoadGate } from './sessionMessageLoadGate';

describe('SessionMessageLoadGate', () => {
    it('makes an in-flight operation stale when its session is invalidated', () => {
        const gate = new SessionMessageLoadGate();
        const inFlight = gate.begin('session-a');

        gate.invalidate('session-a');
        const replacement = gate.begin('session-a');

        expect(gate.isCurrent(inFlight)).toBe(false);
        expect(gate.isCurrent(replacement)).toBe(true);
        expect(() => gate.assertCurrent(inFlight)).toThrow('abandoned');
    });

    it('does not let an old same-session leave cancel a newer operation', () => {
        const gate = new SessionMessageLoadGate();
        const oldOperation = gate.begin('session-a');
        const newOperation = gate.begin('session-a');

        gate.leave(oldOperation);

        expect(gate.isCurrent(newOperation)).toBe(true);
        gate.leave(newOperation);
        expect(gate.isCurrent(newOperation)).toBe(false);
    });
});
