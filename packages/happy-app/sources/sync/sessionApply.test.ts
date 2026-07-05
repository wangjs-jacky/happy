import { describe, expect, it } from 'vitest';
import { createSessionApplyBase } from './sessionApply';

describe('createSessionApplyBase', () => {
    it('keeps existing sessions for incremental updates', () => {
        const result = createSessionApplyBase(
            {
                'session-1': { id: 'session-1' },
                'session-2': { id: 'session-2' },
            },
            new Set(['session-2']),
        );

        expect(result.sessions).toEqual({
            'session-1': { id: 'session-1' },
            'session-2': { id: 'session-2' },
        });
        expect(result.removedIds).toEqual([]);
    });

    it('removes sessions missing from an authoritative snapshot', () => {
        const result = createSessionApplyBase(
            {
                'session-1': { id: 'session-1' },
                'session-2': { id: 'session-2' },
            },
            new Set(['session-2']),
            { replace: true },
        );

        expect(result.sessions).toEqual({});
        expect(result.removedIds).toEqual(['session-1']);
    });
});
