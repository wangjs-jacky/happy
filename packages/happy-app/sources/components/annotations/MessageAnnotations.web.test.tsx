// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web', select: (values: Record<string, unknown>) => values.web ?? values.default } }));
vi.mock('react-native-unistyles', async () => {
    const { appThemes } = await import('@/themePacks');
    return { useUnistyles: () => ({ theme: appThemes.ginghamDark }) };
});
vi.mock('@/text', async () => {
    const { zhHans } = await import('@/text/translations/zh-Hans');
    return { t: (key: string, params: unknown) => { const value = key.split('.').reduce((v: any, part) => v[part], zhHans); return typeof value === 'function' ? value(params) : value; } };
});
vi.mock('./annotationRuntime', async () => {
    const { createAnnotationDraftStore } = await import('./annotationDraft');
    const { useCallback, useSyncExternalStore } = await import('react');
    let id = 0;
    const store = createAnnotationDraftStore({ read: () => undefined, write: () => {}, newId: () => `test-${++id}` });
    return { annotationDraftStore: store, useMessageAnnotations: (sessionId: string) => useSyncExternalStore(store.subscribe, useCallback(() => store.getSnapshot(sessionId), [sessionId])) };
});
import { AnnotationComposer, AnnotatableMessage, AnnotatableFile, prepareAnnotatedMessage, restoreAnnotatedMessage, FileAnnotationPanel, FileAnnotationControls } from './MessageAnnotations.web';
import { annotationDraftStore } from './annotationRuntime';
let root: Root, mount: HTMLDivElement;
let session = 0;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mount = document.createElement('div'); document.body.append(mount); root = createRoot(mount);
    getSelection()!.removeAllRanges();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('CSS', { highlights: new Map() });
    vi.stubGlobal('Highlight', class { constructor(..._ranges: Range[]) {} });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 20, top: 40, bottom: 60, right: 220, width: 200, height: 20 }) });
});
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });

describe('annotation UI with a non-default dark theme', () => {
    it('renders the real list/editor surfaces and hover feedback in gingham dark', () => {
        const sessionId = `theme-${++session}`;
        const item = annotationDraftStore.add(sessionId, { messageId: 'reply', quote: '应用版本', anchorText: '应用版本', start: 0, end: 4 });
        annotationDraftStore.update(sessionId, item.id, '原评论');
        act(() => root.render(<AnnotationComposer sessionId={sessionId} />));
        act(() => (document.querySelector('[data-testid=annotation-summary]') as HTMLButtonElement).click());
        const list = document.querySelector('[data-testid=annotation-list]')!;
        expect(getComputedStyle(list).backgroundColor).toBe('rgb(26, 35, 48)');
        const edit = document.querySelector('[data-testid=annotation-edit]') as HTMLButtonElement;
        act(() => edit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        expect(getComputedStyle(edit).backgroundColor).toBe('rgb(31, 42, 56)');
        act(() => edit.click());
        expect((document.querySelector('[data-testid=annotation-comment-input]') as HTMLTextAreaElement).value).toBe('原评论');
        expect(getComputedStyle(document.querySelector('[data-testid=annotation-editor]')!).backgroundColor).toBe('rgb(26, 35, 48)');
    });
    it('keeps the add menu attached to a live Markdown selection during layout scrolling', () => {
        const sessionId = `scroll-${++session}`;
        act(() => root.render(<AnnotatableMessage sessionId={sessionId} messageId="reply" enabled><p>应用<strong>版本</strong>说明代码。</p></AnnotatableMessage>));
        const source = document.querySelector('[data-testid=annotation-source-content]')!;
        const range = document.createRange(); range.setStart(source.querySelector('p')!.firstChild!, 0); range.setEnd(source.querySelector('strong')!.firstChild!, 2);
        getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
        act(() => source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
        expect(document.querySelector('[data-testid=annotation-add]')).not.toBeNull();
        act(() => window.dispatchEvent(new Event('scroll')));
        expect(document.querySelector('[data-testid=annotation-add]')).not.toBeNull();
        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('[data-testid=annotation-add]')).toBeNull();
    });
    it('uses the selected token on the actual source highlight while retaining its DOM anchor', () => {
        const sessionId = `theme-${++session}`;
        annotationDraftStore.add(sessionId, { messageId: 'reply', quote: '应用版本', anchorText: '应用版本', start: 0, end: 4 });
        act(() => root.render(<AnnotatableMessage sessionId={sessionId} messageId="reply" enabled><p>应用<strong>版本</strong>说明代码。</p></AnnotatableMessage>));
        expect(document.querySelector('[data-testid=annotation-source-reply] style')!.textContent).toContain('background-color: #283544');
        expect((CSS as any).highlights.size).toBe(1);
        expect(document.querySelector('[data-testid=annotation-badge]')!.textContent).toBe('1');
    });
});

it('collects file selections across tabs, edits them in one list, and submits one snapshot', () => {
    const sessionId = `file-${++session}`;
    const first = { path: '/work/first.md', hash: 'baseline-a' };
    const second = { path: '/work/second.md', hash: 'baseline-b' };
    const render = (file: typeof first | null) => <><AnnotatableFile sessionId={sessionId} file={file}><p>应用<strong>版本</strong>说明代码。</p></AnnotatableFile><AnnotationComposer sessionId={sessionId} /><FileAnnotationPanel sessionId={sessionId} /></>;
    const select = () => {
        const source = document.querySelector('[data-testid=annotation-source-content]')!;
        const range = document.createRange();
        range.setStart(source.querySelector('p')!.firstChild!, 0);
        range.setEnd(source.querySelector('strong')!.firstChild!, 2);
        getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
        act(() => source.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
        act(() => (document.querySelector('[data-testid=annotation-add]') as HTMLButtonElement).click());
    };
    act(() => root.render(render(first)));
    select();
    expect(document.querySelector('[data-testid=annotation-editor-file]')!.textContent).toBe('work/first.md');
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(0);
    act(() => (document.querySelector('[data-testid=annotation-save]') as HTMLButtonElement).click());
    const item = annotationDraftStore.getSnapshot(sessionId)[0];
    act(() => annotationDraftStore.update(sessionId, item.id, '把这段写得更具体'));
    act(() => root.render(render(second)));
    expect(document.querySelectorAll('[data-testid=annotation-badge]')).toHaveLength(0);
    select();
    act(() => (document.querySelector('[data-testid=annotation-save]') as HTMLButtonElement).click());
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(2);
    act(() => (document.querySelector('[data-testid=annotation-file-summary]') as HTMLButtonElement).click());
    expect(document.querySelector('[data-testid=annotation-list]')).toBeNull();
    expect(document.querySelector('[data-testid=file-annotation-panel]')).not.toBeNull();
    expect(Array.from(document.querySelectorAll('[data-testid=annotation-source-file]')).map(el => el.textContent)).toEqual(['work/first.md', 'work/second.md']);
    const prepared = prepareAnnotatedMessage(sessionId, '一起修改');
    expect(prepared.text).toContain('baseline-a'); expect(prepared.text).toContain('baseline-b');
    expect(prepared.displayText).toContain('把这段写得更具体'); expect(prepared.displayText).not.toContain('baseline-');
    // Before queue acceptance, preparation alone must leave annotations intact.
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(2);
    act(() => prepared.commit());
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(0);
    act(() => restoreAnnotatedMessage(sessionId, prepared.annotations));
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(2);
    act(() => root.render(render(first)));
    expect(document.querySelectorAll('[data-testid=annotation-badge]')).toHaveLength(1);
    // Background artifact discovery must not lose anchors for unchanged bytes.
    act(() => root.render(render({ ...first, artifact: { workspaceId: 'w', artifactId: 'a', expectedRevision: 'r' } } as typeof first)));
    expect(document.querySelectorAll('[data-testid=annotation-badge]')).toHaveLength(1);
    act(() => root.render(render({ ...first, hash: 'changed' })));
    expect(document.querySelectorAll('[data-testid=annotation-badge]')).toHaveLength(0);
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(2);
    act(() => root.render(render(null)));
    expect(document.querySelector('[data-testid=annotation-source-content]')).toBeNull();
});

it('only point-picks in marking mode, cancels without an empty marker, and locates saved annotations', () => {
    const sessionId = `point-${++session}`;
    const file = { path: '/work/readme.md', hash: 'baseline' };
    act(() => root.render(<><FileAnnotationControls sessionId={sessionId} enabled /><AnnotatableFile sessionId={sessionId} file={file}><div data-annotation-block="text"><p>需要修改的完整段落。</p></div></AnnotatableFile><AnnotationComposer sessionId={sessionId} /><FileAnnotationPanel sessionId={sessionId} /></>));
    const target = document.querySelector('[data-annotation-block]') as HTMLElement;
    expect(getComputedStyle(document.querySelector('[data-testid=file-annotation-list-toggle]')!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    act(() => target.click());
    expect(document.querySelector('[data-testid=annotation-editor]')).toBeNull();
    act(() => (document.querySelector('[data-testid=file-annotation-mode]') as HTMLButtonElement).click());
    expect(target.getAttribute('role')).toBe('button');
    act(() => target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true })));
    expect(document.querySelector('[data-testid=file-annotation-hover]')).not.toBeNull();
    act(() => target.click());
    expect(document.querySelector('[data-testid=annotation-editor-quote]')!.textContent).toBe('需要修改的完整段落。');
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(0);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[data-testid=annotation-editor]')).toBeNull();
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(0);
    // Escape closes the editor first, allowing continued marking.
    act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    act(() => (document.querySelector('[data-testid=annotation-save]') as HTMLButtonElement).click());
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(1);
    expect(document.querySelector('[data-testid=annotation-badge]')!.textContent).toBe('01');
    act(() => (document.querySelector('[data-testid=file-annotation-list-toggle]') as HTMLButtonElement).click());
    act(() => (document.querySelector('[data-testid=file-annotation-jump]') as HTMLButtonElement).click());
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    act(() => (document.querySelector('[data-testid=annotation-remove]') as HTMLButtonElement).click());
    expect(annotationDraftStore.getSnapshot(sessionId)).toHaveLength(0);
    expect(document.querySelector('[data-testid=annotation-badge]')).toBeNull();
});
