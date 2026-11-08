import { describe, expect, it } from 'vitest';
import { getWorkspaceChatWidth } from './documentPresentation';

describe('workspace chat allocation', () => {
    it('leaves room for the document when both sidebars are open', () => {
        const rowWidth = 946;
        const rightPanelWidth = 320;
        const chat = getWorkspaceChatWidth(430, rowWidth, rightPanelWidth);
        expect(chat).toBe(310);
        expect(rowWidth - rightPanelWidth - 6 - chat).toBeGreaterThanOrEqual(310);
    });

    it('preserves the preferred width when there is room, including after collapsing the panel', () => {
        expect(getWorkspaceChatWidth(430, 1600, 320)).toBe(430);
        expect(getWorkspaceChatWidth(430, 946, 0)).toBe(430);
        expect(getWorkspaceChatWidth(430, 0, 0)).toBe(430);
    });
});
