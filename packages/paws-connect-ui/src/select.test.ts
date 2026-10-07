import { afterEach, expect, it, vi } from 'vitest';
import { enhanceSelect } from './select';

afterEach(() => { document.body.replaceChildren(); });
function setup() {
    const select = document.createElement('select');
    select.setAttribute('aria-label', '模型');
    for (const [value, label] of [['a','Model A'],['b','Model B'],['c','Unavailable']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; option.disabled = value === 'c'; select.append(option);
    }
    document.body.append(select); const changed = vi.fn(); select.addEventListener('change', changed);
    const control = enhanceSelect(select);
    return {select, changed, ...control};
}
it('uses a themed listbox and commits a valid choice once', () => {
    const f = setup(); expect(f.select.hidden).toBe(true);
    f.trigger.click(); expect(f.trigger.getAttribute('aria-expanded')).toBe('true');
    const options = f.popup.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    options[2].click(); expect(f.changed).not.toHaveBeenCalled();
    options[1].click(); expect(f.select.value).toBe('b'); expect(f.changed).toHaveBeenCalledTimes(1);
    expect(f.trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(f.trigger);
    f.destroy();
});
it('supports arrows, Home/End, Escape, and outside dismissal without changing the value', () => {
    const f = setup(); f.trigger.click();
    const key = (value: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true}));
    key('End'); expect(document.activeElement?.textContent).toContain('Model B');
    key('Home'); expect(document.activeElement?.textContent).toContain('Model A');
    key('ArrowDown'); expect(document.activeElement?.textContent).toContain('Model B');
    key('Escape'); expect(f.select.value).toBe('a'); expect(document.activeElement).toBe(f.trigger);
    f.trigger.click(); document.body.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true}));
    expect(f.trigger.getAttribute('aria-expanded')).toBe('false'); expect(f.changed).not.toHaveBeenCalled();
    f.destroy();
});
it('opens at the first or last enabled choice with Home/End without committing it', () => {
    const f=setup();f.trigger.focus();
    f.trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
    expect(document.activeElement?.textContent).toContain('Model B');expect(f.select.value).toBe('a');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    f.trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
    expect(document.activeElement?.textContent).toContain('Model A');expect(f.changed).not.toHaveBeenCalled();f.destroy();
});
it('disposes an open control and ignores detached options', () => {
    const f = setup(); f.trigger.click(); const option=f.popup.querySelectorAll<HTMLButtonElement>('[role="option"]')[1];
    f.destroy(); option.click(); expect(f.changed).not.toHaveBeenCalled(); expect(f.popup.isConnected).toBe(false);
});
