// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appThemes } from '@/themePacks';
import type { ActivityDay, ActivitySnapshot } from './codexActivityCalendar';

vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default } }));
vi.mock('react-native-unistyles', async () => {
    const { appThemes } = await vi.importActual<typeof import('@/themePacks')>('@/themePacks');
    return { useUnistyles: () => ({ theme: appThemes.ginghamDark }) };
});
vi.mock('@/text', () => ({ t: (key: string, values?: Record<string, unknown>) => {
    if (key === 'machine.codexUsageHeatmapDay') return `${values?.date}: ${values?.tokens} tokens · ${values?.sessions} sessions`;
    return key;
} }));
import { CodexActivityHeatmap } from './CodexActivityHeatmap.web';

const day = (date: string, totalTokens: number, cached = 0): ActivityDay => ({
    date, totalTokens, inputTokens: totalTokens - 20, cachedInputTokens: cached,
    outputTokens: 20, reasoningOutputTokens: 5, tokenCountEvents: 1, sessions: 2, totalOnlyTokens: 0,
});
const snapshot: ActivitySnapshot = {
    source: 'codex-session-jsonl', timeZone: 'Asia/Shanghai', scannedAt: Date.parse('2026-11-25T10:00:00Z'),
    days: [day('2026-11-24', 200, 150), day('2026-11-25', 300, 270)],
};

describe('Codex activity web interaction', () => {
    let root: Root;
    let host: HTMLDivElement;
    const cell = (date: string) => host.querySelector<HTMLButtonElement>(`[data-testid="codex-usage-day-${date}"]`)!;
    const render = async (value = snapshot) => act(async () => root.render(<CodexActivityHeatmap snapshot={value} language="en" />));
    beforeEach(() => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    });
    afterEach(() => { act(() => root.unmount()); host.remove(); });

    it('keeps all 365 dates, pads weeks, and identifies the exact cross-year range', async () => {
        await render();
        expect(host.querySelectorAll('.paws-activity-cell')).toHaveLength(365);
        expect(host.textContent).toContain('2025-11-26 – 2026-11-25');
        expect(cell('2026-11-25').getAttribute('aria-label')).toContain('300 tokens');
        expect(host.textContent).toContain('codexActivity.scope');
        expect(host.querySelector('.paws-activity-grid')?.getAttribute('style')).toContain('845px');
        expect([...host.querySelectorAll('.paws-activity-month')].map(value => value.textContent)).toContain('Dec');
    });

    it('provides hover and focus descriptions while keeping selection and heat color', async () => {
        await render();
        const old = cell('2026-11-24'); const heat = old.style.backgroundColor;
        await act(async () => old.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('2026-11-24');
        expect(getComputedStyle(document.querySelector('[role="tooltip"]')!).boxSizing).toBe('border-box');
        expect(cell('2026-11-25').getAttribute('aria-pressed')).toBe('true');
        await act(async () => old.click());
        expect(old.getAttribute('aria-pressed')).toBe('true');
        expect(old.style.backgroundColor).toBe(heat);
        await act(async () => old.focus());
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('200 tokens');
        expect(host.querySelector('.paws-activity')?.getAttribute('style')).toContain(appThemes.ginghamDark.colors.surfacePressed);
    });

    it('has one calendar tab stop and navigates by day and week', async () => {
        await render();
        expect(host.querySelectorAll('.paws-activity-cell[tabindex="0"]')).toHaveLength(1);
        const latest = cell('2026-11-25');
        await act(async () => latest.focus());
        await act(async () => latest.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
        expect(document.activeElement).toBe(cell('2026-11-18'));
        await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
        expect(document.activeElement).toBe(cell('2026-11-17'));
        expect(host.querySelectorAll('.paws-activity-cell[tabindex="0"]')).toHaveLength(1);
    });

    it('expands exact selected-day numbers without adding cache or reasoning twice', async () => {
        await render();
        await act(async () => cell('2026-11-24').click());
        const toggle = host.querySelector<HTMLButtonElement>('[data-testid="codex-activity-details-toggle"]')!;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        await act(async () => toggle.click());
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const details = host.querySelector('[data-testid="codex-usage-detail"]')!;
        expect([...details.querySelectorAll('dd')].map(value => value.textContent)).toEqual(['30', '150', '20']);
        expect(details.textContent).toContain('200 token');
        await act(async () => toggle.click());
        expect(host.querySelector('[data-testid="codex-usage-detail"]')).toBeNull();
    });

    it('keeps manual scroll and day selection across snapshots and viewport changes', async () => {
        await render();
        const scroll = host.querySelector<HTMLDivElement>('.paws-activity-scroll')!;
        scroll.scrollLeft = 137;
        await act(async () => cell('2026-11-24').click());
        await render({ ...snapshot, scannedAt: snapshot.scannedAt + 1000, days: [...snapshot.days!] });
        await act(async () => window.dispatchEvent(new Event('resize')));
        expect(scroll.scrollLeft).toBe(137);
        expect(cell('2026-11-24').getAttribute('aria-pressed')).toBe('true');
    });

    it('updates a visible tooltip from the latest snapshot without another pointer move', async () => {
        await render();
        await act(async () => cell('2026-11-24').focus());
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('200 tokens');
        await render({ ...snapshot, days: [day('2026-11-24', 250, 150), day('2026-11-25', 300, 270)] });
        expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('250 tokens');
    });

    it('clears a tooltip on scroll, Escape, or leaving, without closing other surfaces', async () => {
        await render();
        const latest = cell('2026-11-25');
        await act(async () => latest.focus());
        const bubbled = vi.fn(); document.addEventListener('keydown', bubbled);
        const modalClose = vi.fn(); document.addEventListener('keyup', modalClose);
        await act(async () => latest.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        await act(async () => latest.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('[role="tooltip"]')).toBeNull();
        expect(bubbled).not.toHaveBeenCalled();
        expect(modalClose).not.toHaveBeenCalled();
        await act(async () => latest.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
        expect(modalClose).toHaveBeenCalledTimes(1);
        document.removeEventListener('keydown', bubbled);
        document.removeEventListener('keyup', modalClose);
        await act(async () => latest.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        await act(async () => window.dispatchEvent(new Event('scroll')));
        expect(document.querySelector('[role="tooltip"]')).toBeNull();
    });
});
