import { describe, it, expect } from 'vitest';
import { filterVisibleMessages } from './messageVisibility';

describe('filterVisibleMessages', () => {
    it('drops messages with meta.hidden', () => {
        const msgs = [
            { id: 'a', meta: { hidden: true } },
            { id: 'b', meta: {} },
            { id: 'c' },
        ] as any;
        expect(filterVisibleMessages(msgs).map((m: any) => m.id)).toEqual(['b', 'c']);
    });

    it('keeps messages with meta.hidden === false', () => {
        const msgs = [
            { id: 'x', meta: { hidden: false } },
            { id: 'y', meta: { hidden: true } },
        ] as any;
        expect(filterVisibleMessages(msgs).map((m: any) => m.id)).toEqual(['x']);
    });
});
