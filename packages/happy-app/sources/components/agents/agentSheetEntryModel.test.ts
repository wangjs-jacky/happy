import { describe, expect, it } from 'vitest';
import { getAgentSheetEntryState } from './agentSheetEntryModel';

describe('getAgentSheetEntryState', () => {
    it('opens the sheet when built-in agents exist even without custom agents', () => {
        expect(getAgentSheetEntryState({ customAgentCount: 0, builtinAgentCount: 2 })).toEqual({
            opensSheet: true,
            showsEmpty: false,
        });
    });

    it('shows empty state only when no custom or built-in agents exist', () => {
        expect(getAgentSheetEntryState({ customAgentCount: 0, builtinAgentCount: 0 })).toEqual({
            opensSheet: false,
            showsEmpty: true,
        });
    });
});
