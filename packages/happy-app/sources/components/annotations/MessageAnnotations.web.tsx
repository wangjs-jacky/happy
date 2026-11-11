import * as React from 'react';
import { createPortal } from 'react-dom';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { fileAnnotationLabel, fileAnnotationSourceId, formatAnnotatedMessage, type MessageAnnotation, type AnnotationSelection } from './annotationDraft';
import { annotationDraftStore, useMessageAnnotations } from './annotationRuntime';
import { annotationRange, readAnnotationRange, readAnnotationSelection } from './annotationSelection';
import type { AnnotationSourceProps, AnnotationComposerProps, FileAnnotationSourceProps } from './MessageAnnotations';
import { useFileWorkspace } from '../fileWorkspace/context';
import { fileAnnotationUi, useFileAnnotationUi } from './fileAnnotationUi';
export { useMessageAnnotations };

type Anchor = { left: number; top: number; bottom: number; right?: number };
type MovingAnchor = { getAnchor?: () => Anchor | null; getBounds?: () => DOMRect | undefined };
type EditRequest = { sessionId: string; id: string; anchor: Anchor; focus: HTMLElement | null; sequence: number; selection?: AnnotationSelection } & MovingAnchor;
let editRequest: EditRequest | null = null;
let sequence = 0;
const editListeners = new Set<() => void>();
const subscribeEditor = (listener: () => void) => { editListeners.add(listener); return () => { editListeners.delete(listener); }; };
const getEditor = () => editRequest;
function requestEdit(sessionId: string, id: string, anchor: Anchor, focus: HTMLElement | null, moving: MovingAnchor = {}) {
    editRequest = { sessionId, id, anchor, focus, sequence: ++sequence, ...moving };
    editListeners.forEach(listener => listener());
}
function requestCreate(sessionId: string, selection: AnnotationSelection, anchor: Anchor, focus: HTMLElement | null, moving: MovingAnchor) {
    editRequest = { sessionId, id: 'new-file-annotation', selection, anchor, focus, sequence: ++sequence, ...moving };
    editListeners.forEach(listener => listener());
}
function editingItem(sessionId: string, items: readonly MessageAnnotation[], request: EditRequest | null) {
    if (request?.sessionId !== sessionId) return undefined;
    return request.selection ? { ...request.selection, id: request.id, revision: 0, comment: '' } : items.find(a => a.id === request.id);
}

function closeEditor() {
    const focus = editRequest?.focus;
    editRequest = null;
    editListeners.forEach(listener => listener());
    if (focus?.isConnected) focus.focus({ preventScroll: true });
}

function Icon({ name }: { name: 'edit' | 'trash' | 'close' | 'comment' | 'check' }) {
    const paths = { edit: 'm16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5', trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7', close: 'm6 6 12 12M6 18 18 6', comment: 'M21 11a8 8 0 0 1-8 8H6l-4 3V7a5 5 0 0 1 5-5h9a5 5 0 0 1 5 5v4ZM7 7h9M7 11h6', check: 'm5 12 4 4L20 5' };
    return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
function useAnnotationStyles() {
    const { theme } = useUnistyles();
    const c = theme.colors;
    const button: React.CSSProperties = { border: 0, borderRadius: 8, padding: '7px 9px', font: 'inherit', fontSize: 13, cursor: 'pointer', outlineColor: c.accent, color: c.text, background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0 };
    return { theme, c, button };
}
function SmallButton({ children, style, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { c, button } = useAnnotationStyles();
    const [hover, setHover] = React.useState(false);
    return <button {...props} type={props.type ?? 'button'} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ ...button, ...(hover ? { background: c.surfacePressed } : {}), ...style }}>{children}</button>;
}
function FloatingPanel({ anchor, children, label, onClose, testId = 'annotation-editor', width = 460, maxHeight = 'calc(100dvh - 24px)', ignoreOutside, getAnchor, getBounds }: {
    anchor: Anchor; children: React.ReactNode; label: string; onClose: () => void; testId?: string; width?: number;
    maxHeight?: string; ignoreOutside?: HTMLElement | null;
} & MovingAnchor) {
    const { c } = useAnnotationStyles();
    const ref = React.useRef<HTMLDivElement>(null);
    const [position, setPosition] = React.useState({ left: 12, top: 12 });
    React.useLayoutEffect(() => {
        let frame: number | undefined;
        const layout = () => {
            if (!ref.current) return;
            const live = getAnchor?.();
            if (getAnchor && !live) { onClose(); return; }
            const target = live ?? anchor;
            const bounds = getBounds?.();
            const minLeft = Math.max(12, (bounds?.left ?? 0) + 12);
            const minTop = Math.max(12, (bounds?.top ?? 0) + 12);
            const right = Math.min(window.innerWidth - 12, (bounds?.right ?? window.innerWidth) - 12);
            const bottom = Math.min(window.innerHeight - 12, (bounds?.bottom ?? window.innerHeight) - 12);
            ref.current.style.maxWidth = Math.max(0, right - minLeft) + 'px';
            if (getBounds) ref.current.style.maxHeight = Math.max(0, bottom - minTop) + 'px';
            const rect = ref.current.getBoundingClientRect();
            const preferredTop = getBounds
                ? (target.bottom + rect.height + 10 <= bottom ? target.bottom + 10 : target.top - rect.height - 10)
                : (target.top - rect.height - 10 >= minTop ? target.top - rect.height - 10 : target.bottom + 10);
            setPosition({ left: Math.max(minLeft, Math.min(target.left, right - rect.width)), top: Math.max(minTop, Math.min(preferredTop, bottom - rect.height)) });
        };
        const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; layout(); }); };
        const observer = new ResizeObserver(schedule);
        observer.observe(ref.current!);
        if (getAnchor) window.addEventListener('scroll', schedule, true);
        window.addEventListener('resize', schedule);
        layout();
        return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
    }, [anchor, getAnchor, getBounds, onClose]);
    React.useEffect(() => {
        const pointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !ignoreOutside?.contains(event.target as Node)) onClose(); };
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
        document.addEventListener('pointerdown', pointer);
        document.addEventListener('keydown', key, true);
        return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key, true); };
    }, [onClose, ignoreOutside]);
    return createPortal(<div ref={ref} role="dialog" aria-label={label} data-testid={testId} style={{ position: 'fixed', zIndex: 10000, ...position, boxSizing: 'border-box', width: `min(${width}px, calc(100vw - 24px))`, maxHeight, overflowY: 'auto', padding: 16, borderRadius: 14, color: c.text, background: c.surface, border: `1px solid ${c.divider}`, boxShadow: `0 8px 36px ${c.shadow.color}`, fontFamily: 'inherit', fontSize: 14 }}>{children}</div>, document.body);
}
function CommentEditor({ sessionId, item, request, number, onClose }: { sessionId: string; item: MessageAnnotation; request: EditRequest; number: number; onClose: () => void }) {
    const { c, button } = useAnnotationStyles();
    const [comment, setComment] = React.useState(item.comment);
    const [error, setError] = React.useState('');
    const input = React.useRef<HTMLTextAreaElement>(null);
    const labelId = React.useId();
    React.useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
    const action = (fn: () => void) => { try { fn(); onClose(); } catch { setError(t('messageAnnotations.saveError')); } };
    const save = () => action(() => {
        if (request.selection) {
            const created = annotationDraftStore.add(sessionId, request.selection, comment);
            fileAnnotationUi.update(sessionId, { activeId: created.id });
        } else annotationDraftStore.update(sessionId, item.id, comment);
    });
    const quote = <blockquote data-testid="annotation-editor-quote" style={{ margin: '10px 0 14px', paddingInlineStart: 10, borderInlineStart: `2px solid ${c.accent}`, maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.7 }}>{item.quote}</blockquote>;
    return <FloatingPanel anchor={request.anchor} getAnchor={request.getAnchor} getBounds={request.getBounds} width={item.file ? 336 : 460} label={t('messageAnnotations.edit')} onClose={onClose}>
        <form onSubmit={event => { event.preventDefault(); save(); }} onKeyDown={event => { event.stopPropagation(); if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save(); } }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: c.textSecondary, fontSize: 12 }}>
                <Icon name="comment" /><span style={{ flex: 1 }}>{request.selection ? t('messageAnnotations.addFile') : t('messageAnnotations.number', { number })}</span>
                <SmallButton aria-label={t('common.cancel')} onClick={onClose}><Icon name="close" /></SmallButton>
            </div>
            {item.file ? <>
                <div data-testid="annotation-editor-file" title={item.file.path} style={{ fontSize: 11, color: c.textSecondary, marginTop: 4 }}>{fileAnnotationLabel(item.file)}</div>
                <details style={{ marginTop: 10, color: c.textSecondary, fontSize: 12 }}><summary style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.quote}>{item.quote.slice(0, 34)}{item.quote.length > 34 ? '…' : ''}</summary>{quote}</details>
            </> : quote}
            {!item.file && <label id={labelId} style={{ fontSize: 12, color: c.textSecondary }}>{t('messageAnnotations.comment')}</label>}
            <textarea ref={input} data-testid="annotation-comment-input" aria-label={item.file ? t('messageAnnotations.yourComment') : undefined} aria-labelledby={item.file ? undefined : labelId} value={comment} onChange={event => setComment(event.target.value)} placeholder={t(item.file ? 'messageAnnotations.filePlaceholder' : 'messageAnnotations.placeholder')} style={{ width: '100%', minHeight: item.file ? 104 : 88, maxHeight: 220, boxSizing: 'border-box', resize: 'vertical', border: 0, borderRadius: 6, outlineColor: c.accent, background: c.surface, color: c.text, font: 'inherit', lineHeight: 1.7, padding: '12px 2px', marginTop: 8 }} />
            {error && <p role="alert" style={{ color: c.textDestructive, fontSize: 12 }}>{error}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${c.divider}`, paddingTop: 10 }}>
                {!request.selection && <SmallButton aria-label={t('messageAnnotations.remove')} onClick={() => action(() => annotationDraftStore.remove(sessionId, item.id))} style={{ color: c.textSecondary }}><Icon name="trash" /></SmallButton>}
                <span style={{ flex: 1 }} /><SmallButton onClick={onClose}>{t('common.cancel')}</SmallButton>
                <button type="submit" data-testid="annotation-save" style={{ ...button, background: c.button.primary.background, color: c.button.primary.tint }}>{t('common.save')}</button>
            </div>
        </form>
    </FloatingPanel>;
}

export function AnnotationComposer({ sessionId }: AnnotationComposerProps) {
    const allItems = useMessageAnnotations(sessionId);
    const items = React.useMemo(() => allItems.filter(a => !a.file), [allItems]);
    const fileItems = allItems.filter(a => a.file);
    const workspace = useFileWorkspace();
    const request = React.useSyncExternalStore(subscribeEditor, getEditor, () => null);
    const [open, setOpen] = React.useState(false);
    const [error, setError] = React.useState('');
    const { c } = useAnnotationStyles();
    const ref = React.useRef<HTMLDivElement>(null);
    const trigger = React.useRef<HTMLButtonElement>(null);
    const listId = React.useId();
    const closeList = React.useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
    React.useEffect(() => { setOpen(false); setError(''); return () => { if (editRequest?.sessionId === sessionId) closeEditor(); }; }, [sessionId]);
    const editedItem = request?.sessionId === sessionId ? items.find(a => a.id === request.id) : undefined;
    const close = React.useCallback(() => { closeEditor(); }, []);
    return <div ref={ref} data-testid="annotation-composer" style={{ position: 'relative', minWidth: 0, padding: allItems.length ? '12px 14px 0' : 0, color: c.text }}>
        {fileItems.length > 0 && <SmallButton data-testid="annotation-file-summary" title={t('messageAnnotations.manageInFile')} onClick={() => {
            fileAnnotationUi.update(sessionId, { panelOpen: true });
            if (!workspace?.snapshot.open || !/\.(md|markdown)$/i.test(workspace.snapshot.active ?? '')) void workspace?.openReference(fileItems[0].file!.path);
        }} style={{ border: `1px solid ${c.divider}`, background: c.surface, fontSize: 12, marginInlineEnd: items.length ? 8 : 0 }}><Icon name="comment" />{t('messageAnnotations.count', { count: fileItems.length })}</SmallButton>}
        {items.length > 0 && <button ref={trigger} type="button" data-testid="annotation-summary" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(value => !value)} style={{ border: `1px solid ${c.divider}`, borderRadius: 10, padding: '6px 10px', background: c.surface, color: c.text, cursor: 'pointer', display: 'inline-flex', gap: 7, alignItems: 'center', font: 'inherit', fontSize: 12 }}><Icon name="comment" />{t('messageAnnotations.count', { count: items.length })}<span aria-hidden="true">{open ? '⌄' : '⌃'}</span></button>}
        {open && items.length > 0 && trigger.current && <FloatingPanel anchor={trigger.current.getBoundingClientRect()} label={t('messageAnnotations.list')} testId="annotation-list" width={640} maxHeight="min(440px, 50dvh)" onClose={closeList} ignoreOutside={trigger.current}><div id={listId}>
            {items.map((item, index) => <div key={item.id} data-testid={`annotation-row-${item.id}`} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto', gap: 8, padding: '14px 0', borderTop: index ? `1px solid ${c.divider}` : undefined, fontSize: 13 }}>
                <span style={{ color: c.textSecondary }}>{index + 1}.</span><div style={{ minWidth: 0 }}>{item.file && <div data-testid="annotation-source-file" title={item.file.path} style={{ color: c.textSecondary, fontSize: 12, overflowWrap: 'anywhere', marginBottom: 6 }}>{fileAnnotationLabel(item.file)}</div>}<div style={{ color: c.textSecondary, fontSize: 11 }}>{t('messageAnnotations.selectedText')}</div><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65, margin: '3px 0 10px' }}>{item.quote}</div><div style={{ color: c.textSecondary, fontSize: 11 }}>{item.comment ? t('messageAnnotations.yourComment') : t('messageAnnotations.noComment')}</div>{item.comment && <div data-testid="annotation-saved-comment" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.65, marginTop: 3 }}>{item.comment}</div>}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><SmallButton data-testid="annotation-edit" aria-label={t('messageAnnotations.editNumber', { number: index + 1 })} onClick={event => { requestEdit(sessionId, item.id, event.currentTarget.getBoundingClientRect(), trigger.current); setOpen(false); }}><Icon name="edit" /></SmallButton><SmallButton data-testid="annotation-remove" aria-label={t('messageAnnotations.removeNumber', { number: index + 1 })} onClick={() => { try { annotationDraftStore.remove(sessionId, item.id); } catch { setError(t('messageAnnotations.saveError')); } }}><Icon name="trash" /></SmallButton></div>
            </div>)}
        </div></FloatingPanel>}
        {error && <div role="alert" style={{ color: c.textDestructive, fontSize: 12 }}>{error}</div>}
        {editedItem && request && <CommentEditor key={request.sequence} sessionId={sessionId} item={editedItem} request={request} number={items.indexOf(editedItem) + 1} onClose={close} />}
    </div>;
}

export function FileAnnotationControls({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
    const ui = useFileAnnotationUi(sessionId);
    const items = useMessageAnnotations(sessionId).filter(a => a.file);
    const { c } = useAnnotationStyles();
    React.useEffect(() => { if (!enabled) fileAnnotationUi.update(sessionId, { marking: false }); }, [enabled, sessionId, ui.marking]);
    return <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <SmallButton data-testid="file-annotation-mode" disabled={!enabled} aria-pressed={ui.marking} title={enabled ? t('messageAnnotations.markHint') : t('messageAnnotations.saveBeforeMarking')} onClick={() => fileAnnotationUi.update(sessionId, { marking: !ui.marking })} style={{ opacity: enabled ? 1 : 0.45, background: ui.marking ? c.surfaceSelected : 'transparent', color: ui.marking ? c.accent : c.textSecondary }}><Icon name={ui.marking ? 'check' : 'comment'} />{t(ui.marking ? 'messageAnnotations.finishMarking' : 'messageAnnotations.mark')}</SmallButton>
        <SmallButton data-testid="file-annotation-list-toggle" aria-expanded={ui.panelOpen} onClick={() => fileAnnotationUi.update(sessionId, { panelOpen: !ui.panelOpen })} style={{ background: ui.panelOpen ? c.surfaceSelected : 'transparent', color: ui.panelOpen ? c.accent : c.textSecondary }}>{t('messageAnnotations.annotation')}{items.length > 0 && <span style={{ fontSize: 11 }}>{items.length}</span>}</SmallButton>
    </div>;
}
export function FileAnnotationHint({ sessionId }: { sessionId: string }) {
    const ui = useFileAnnotationUi(sessionId);
    const { c } = useAnnotationStyles();
    React.useEffect(() => {
        if (!ui.marking) return;
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !editRequest) fileAnnotationUi.update(sessionId, { marking: false }); };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, [sessionId, ui.marking]);
    if (!ui.marking) return null;
    return <div data-testid="file-annotation-hint" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', fontSize: 12, color: c.textSecondary, borderBottom: `1px solid ${c.divider}`, background: c.surface }}><Icon name="comment" />{t('messageAnnotations.markHint')}<span style={{ marginInlineStart: 'auto', opacity: 0.65 }}>Esc</span></div>;
}
export function FileAnnotationPanel({ sessionId, compact = false, showPreview }: { sessionId: string; compact?: boolean; showPreview?: (path: string) => void }) {
    const ui = useFileAnnotationUi(sessionId);
    const items = useMessageAnnotations(sessionId);
    const files = items.filter(a => a.file);
    const workspace = useFileWorkspace();
    const { c } = useAnnotationStyles();
    const request = React.useSyncExternalStore(subscribeEditor, getEditor, () => null);
    const edited = editingItem(sessionId, items, request);
    const close = React.useCallback(() => closeEditor(), []);
    const [error, setError] = React.useState('');
    const panel = React.useRef<HTMLElement>(null);
    const jump = async (item: MessageAnnotation) => {
        try {
            showPreview?.(item.file!.path);
            if (workspace) {
                await workspace.openReference(item.file!.path);
                const doc = workspace.controller.getSnapshot().documents[item.file!.path];
                if (doc?.phase !== 'ready' || doc.hash !== item.file!.hash || doc.draft !== doc.content) {
                    fileAnnotationUi.update(sessionId, { unlocatedId: item.id });
                    return;
                }
            }
            if (compact) fileAnnotationUi.update(sessionId, { panelOpen: false });
            fileAnnotationUi.focus(sessionId, item.id);
        } catch { setError(t('messageAnnotations.unlocated')); }
    };
    return <>
        {ui.panelOpen && <aside ref={panel} data-testid="file-annotation-panel" aria-label={t('messageAnnotations.fileList')} style={{ ...(compact ? { position: 'absolute', insetInlineEnd: 12, top: 12, bottom: 12, borderRadius: 14, boxShadow: `0 8px 28px ${c.shadow.color}` } : { position: 'relative' }), zIndex: 5, flexShrink: 0, width: 304, maxWidth: 'calc(100% - 24px)', minHeight: 0, display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: c.surface, color: c.text, border: `1px solid ${c.divider}`, fontFamily: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 12px 8px' }}><Icon name="comment" /><span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{t('messageAnnotations.fileList')}</span><SmallButton data-testid="file-annotation-list-close" aria-label={t('common.cancel')} onClick={() => fileAnnotationUi.update(sessionId, { panelOpen: false })}><Icon name="close" /></SmallButton></div>
            <p style={{ margin: '0 14px 12px', color: c.textSecondary, fontSize: 11, lineHeight: 1.6 }}>{t('messageAnnotations.sendTogether')}</p>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 10px' }}>
                {!files.length && <p style={{ padding: 12, color: c.textSecondary, fontSize: 13, lineHeight: 1.8 }}>{t('messageAnnotations.emptyFileList')}</p>}
                {files.map(item => {
                    const number = items.indexOf(item) + 1;
                    const doc = workspace?.snapshot.documents[item.file!.path];
                    const changed = ui.unlocatedId === item.id || (doc?.phase === 'ready' && (doc.hash !== item.file!.hash || doc.draft !== doc.content));
                    return <article key={item.id} data-testid="file-annotation-row" style={{ padding: '14px 10px', marginBottom: 6, borderRadius: 10, background: ui.activeId === item.id ? c.surfaceSelected : 'transparent', border: `1px solid ${ui.activeId === item.id ? c.divider : 'transparent'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: c.textSecondary }}><span style={{ color: c.accent, fontWeight: 600 }}>{String(number).padStart(2, '0')}</span><span data-testid="annotation-source-file" title={item.file!.path} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileAnnotationLabel(item.file!)}</span></div>
                        <div title={item.quote} style={{ marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.textSecondary, fontSize: 12 }}>{item.quote}</div>
                        <p data-testid="annotation-saved-comment" style={{ margin: '8px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.75 }}>{item.comment || t('messageAnnotations.fileReview')}</p>
                        {changed && <div role="status" style={{ fontSize: 11, lineHeight: 1.6, color: c.textSecondary }}>{t('messageAnnotations.unlocated')}</div>}
                        <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginTop: 8 }}>
                            <SmallButton data-testid="file-annotation-jump" disabled={changed} onClick={() => { void jump(item); }} style={{ color: c.accent, opacity: changed ? 0.4 : 1, fontSize: 11, padding: '6px 2px' }}>{t('messageAnnotations.backToPassage')}</SmallButton><span style={{ flex: 1 }} />
                            <SmallButton data-testid="annotation-edit" aria-label={t('messageAnnotations.editNumber', { number })} onClick={event => {
                                const target = event.currentTarget;
                                requestEdit(sessionId, item.id, target.getBoundingClientRect(), target, { getAnchor: () => target.isConnected ? target.getBoundingClientRect() : null, getBounds: () => panel.current?.getBoundingClientRect() });
                                fileAnnotationUi.update(sessionId, { activeId: item.id });
                            }}><Icon name="edit" /></SmallButton>
                            <SmallButton data-testid="annotation-remove" aria-label={t('messageAnnotations.removeNumber', { number })} onClick={() => { try { annotationDraftStore.remove(sessionId, item.id); } catch { setError(t('messageAnnotations.saveError')); } }}><Icon name="trash" /></SmallButton>
                        </div>
                    </article>;
                })}
            </div>
            {error && <p role="alert" style={{ color: c.textDestructive, fontSize: 12, margin: 12 }}>{error}</p>}
            <div style={{ borderTop: `1px solid ${c.divider}`, padding: 8 }}><SmallButton onClick={() => fileAnnotationUi.update(sessionId, { panelOpen: false, marking: true })} style={{ width: '100%', color: c.accent }}>{t('messageAnnotations.continueMarking')}</SmallButton></div>
        </aside>}
        {edited?.file && request && <CommentEditor key={request.sequence} sessionId={sessionId} item={edited} request={request} number={request.selection ? items.length + 1 : items.indexOf(edited) + 1} onClose={close} />}
    </>;
}

export function AnnotatableMessage({ sessionId, messageId, enabled, children }: AnnotationSourceProps) {
    if (!enabled || !sessionId) return <>{children}</>;
    return <AnnotationSource sessionId={sessionId} messageId={messageId}>{children}</AnnotationSource>;
}
export function AnnotatableFile({ sessionId, file, children }: FileAnnotationSourceProps) {
    if (!sessionId || !file) return <>{children}</>;
    return <AnnotationSource key={sessionId + fileAnnotationSourceId(file)} sessionId={sessionId} messageId={fileAnnotationSourceId(file)} file={file}>{children}</AnnotationSource>;
}
function AnnotationSource({ sessionId, messageId, file, children }: Omit<AnnotationSourceProps, 'enabled'> & { sessionId: string; file?: FileAnnotationSourceProps['file'] }) {
    const items = useMessageAnnotations(sessionId);
    const annotations = React.useMemo(() => items.filter(a => a.messageId === messageId), [items, messageId]);
    const ui = useFileAnnotationUi(sessionId);
    const marking = !!file && ui.marking;
    const root = React.useRef<HTMLDivElement>(null);
    const source = React.useRef<HTMLDivElement>(null);
    const uniqueId = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const highlightName = `paws-annotation-${uniqueId}`;
    const { c, button } = useAnnotationStyles();
    const [selection, setSelection] = React.useState<ReturnType<typeof readAnnotationSelection>>(null);
    const [error, setError] = React.useState('');
    type Box = { left: number; top: number; width: number; height: number };
    const [hover, setHover] = React.useState<Box | null>(null);
    const [activeBox, setActiveBox] = React.useState<Box | null>(null);
    const [badges, setBadges] = React.useState<Array<{ id: string; top: number; number: number }>>([]);
    const request = React.useSyncExternalStore(subscribeEditor, getEditor, () => null);
    const pending = request?.sessionId === sessionId && request.selection?.messageId === messageId ? request.selection : null;
    const box = (rect: DOMRect): Box => {
        const base = root.current!.getBoundingClientRect();
        return { left: rect.left - base.left - 5, top: rect.top - base.top - 5, width: rect.width + 10, height: rect.height + 10 };
    };
    React.useLayoutEffect(() => {
        if (!annotations.length && !pending) { setBadges([]); setActiveBox(null); return; }
        let frame: number | undefined;
        const layout = () => {
            if (!source.current || !root.current) return;
            const ranges: Range[] = [];
            const positions: typeof badges = [];
            let focused: Box | null = null;
            for (const a of annotations) {
                const range = annotationRange(source.current, a);
                if (!range) continue;
                ranges.push(range);
                const rect = range.getBoundingClientRect();
                positions.push({ id: a.id, number: items.indexOf(a) + 1, top: (file ? rect.top : rect.bottom - 24) - root.current.getBoundingClientRect().top });
                if (file && ui.activeId === a.id) focused = box(rect);
            }
            if (pending) {
                const range = annotationRange(source.current, pending);
                if (range) { ranges.push(range); focused = box(range.getBoundingClientRect()); }
            }
            const api = CSS as unknown as { highlights?: { set: (name: string, highlight: unknown) => void; delete: (name: string) => void } };
            const Constructor = (globalThis as unknown as { Highlight?: new(...ranges: Range[]) => unknown }).Highlight;
            if (api.highlights && Constructor) api.highlights.set(highlightName, new Constructor(...ranges));
            positions.sort((a, b) => a.top - b.top);
            for (let i = 1; i < positions.length; i++) positions[i].top = Math.max(positions[i].top, positions[i - 1].top + 26);
            setBadges(positions); setActiveBox(focused);
        };
        const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(() => { frame = undefined; layout(); }); };
        const observer = new ResizeObserver(schedule);
        const mutations = new MutationObserver(schedule);
        observer.observe(source.current!); mutations.observe(source.current!, { subtree: true, childList: true, characterData: true });
        window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); layout();
        return () => { observer.disconnect(); mutations.disconnect(); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); if (frame !== undefined) cancelAnimationFrame(frame); (CSS as unknown as { highlights?: { delete: (name: string) => void } }).highlights?.delete(highlightName); };
    }, [annotations, items, highlightName, pending, ui.activeId, file?.path]);
    React.useEffect(() => {
        if (!file || !ui.focus || !source.current) return;
        const item = items.find(a => a.id === ui.focus!.id);
        if (item?.file?.path !== file.path) return;
        const range = item.messageId === messageId ? annotationRange(source.current, item) : null;
        if (!range) { fileAnnotationUi.update(sessionId, { unlocatedId: item.id }); return; }
        if (ui.unlocatedId === item.id) fileAnnotationUi.update(sessionId, { unlocatedId: undefined });
        const target = range.startContainer.parentElement;
        target?.scrollIntoView({ block: 'center', behavior: 'auto' });
        Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[data-annotation-id]') ?? []).find(node => node.dataset.annotationId === item.id)?.focus({ preventScroll: true });
    }, [file?.path, messageId, ui.focus, items, sessionId]);
    React.useEffect(() => {
        setHover(null);
        if (!marking || !source.current) return;
        const nodes = Array.from(source.current.querySelectorAll<HTMLElement>('[data-annotation-block]'));
        for (const node of nodes) { node.tabIndex = 0; node.setAttribute('role', 'button'); node.setAttribute('aria-label', t('messageAnnotations.mark') + ': ' + (node.textContent ?? '').slice(0, 50)); }
        const clear = () => setHover(null);
        window.addEventListener('scroll', clear, true);
        return () => { window.removeEventListener('scroll', clear, true); for (const node of nodes) { node.removeAttribute('tabindex'); node.removeAttribute('role'); node.removeAttribute('aria-label'); } };
    }, [marking]);
    React.useEffect(() => {
        if (!selection) return;
        const dismiss = () => setSelection(null);
        const collapse = () => { if (window.getSelection()?.isCollapsed) dismiss(); };
        const reposition = () => {
            const next = source.current && readAnnotationSelection(source.current, messageId, window.getSelection());
            setSelection(next && next.rect.bottom > 0 && next.rect.top < window.innerHeight ? next : null);
        };
        const pointer = (event: PointerEvent) => { if (!(event.target as Element).closest('[data-testid=annotation-add]')) dismiss(); };
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
        document.addEventListener('pointerdown', pointer); document.addEventListener('keydown', key); document.addEventListener('selectionchange', collapse);
        window.addEventListener('scroll', reposition, true); window.addEventListener('resize', dismiss);
        return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); document.removeEventListener('selectionchange', collapse); window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', dismiss); };
    }, [selection, messageId]);
    React.useEffect(() => () => {
        if (!file || editRequest?.sessionId !== sessionId) return;
        const current = editingItem(sessionId, annotationDraftStore.getSnapshot(sessionId), editRequest);
        if (current?.messageId === messageId) closeEditor();
    }, [sessionId, messageId, !!file]);
    const moving = (data: AnnotationSelection, target?: HTMLElement): MovingAnchor => ({
        getAnchor: () => target?.isConnected ? target.getBoundingClientRect() : source.current ? annotationRange(source.current, data)?.getBoundingClientRect() ?? null : null,
        getBounds: () => source.current?.closest<HTMLElement>('[data-testid="workspace-reading-pane"]')?.getBoundingClientRect(),
    });
    const open = (value: NonNullable<typeof selection>, target?: HTMLElement) => {
        try {
            const { rect, ...selected } = value;
            const data = { ...selected, ...(file ? { file } : {}) };
            if (file) {
                const existing = annotationDraftStore.getSnapshot(sessionId).find(a => a.messageId === messageId && a.start === data.start && a.end === data.end && a.anchorText === data.anchorText);
                if (existing) { requestEdit(sessionId, existing.id, rect, root.current, moving(data, target)); fileAnnotationUi.update(sessionId, { activeId: existing.id }); }
                else requestCreate(sessionId, data, rect, root.current, moving(data, target));
            } else {
                const item = annotationDraftStore.add(sessionId, data);
                requestEdit(sessionId, item.id, rect, root.current);
            }
            setSelection(null); setHover(null); window.getSelection()?.removeAllRanges();
        } catch { setError(t('messageAnnotations.saveError')); }
    };
    const pointTarget = (eventTarget: EventTarget | null) => {
        if (!(eventTarget instanceof Element)) return null;
        const element = eventTarget.closest<HTMLElement>('[data-annotation-block],p,h1,h2,h3,h4,li');
        return element && source.current?.contains(element) ? element : null;
    };
    const pick = (target: HTMLElement) => {
        if (editRequest || !source.current) return;
        const range = document.createRange(); range.selectNodeContents(target);
        const data = readAnnotationRange(source.current, messageId, range);
        if (data) open(data, target);
    };
    const capture = () => { if (!editRequest && source.current) setSelection(readAnnotationSelection(source.current, messageId, window.getSelection())); };
    const outline: React.CSSProperties = { position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box', border: `1px solid ${c.accent}`, borderRadius: 6, zIndex: 1 };
    return <div ref={root} tabIndex={-1} style={{ position: 'relative', width: '100%', minWidth: 0 }} data-testid={`annotation-source-${messageId}`}>
        <style>{`::highlight(${highlightName}) { background-color: ${c.surfaceSelected}; color: ${c.text}; }`}</style>
        {file && activeBox && <div data-testid="file-annotation-active-outline" style={{ ...outline, ...activeBox, opacity: 0.65 }} />}
        {marking && hover && !request && <div data-testid="file-annotation-hover" style={{ ...outline, ...hover }} />}
        <div ref={source} onMouseUp={capture} onKeyUp={capture}
            onPointerMove={event => { if (marking && !editRequest) { const target = pointTarget(event.target); setHover(target ? box(target.getBoundingClientRect()) : null); } }}
            onPointerLeave={() => setHover(null)}
            onClickCapture={event => { if (!marking) return; event.preventDefault(); event.stopPropagation(); if (window.getSelection()?.toString().trim()) return; const target = pointTarget(event.target); if (target) pick(target); }}
            onKeyDown={event => { if (marking && (event.key === 'Enter' || event.key === ' ')) { const target = pointTarget(event.target); if (target) { event.preventDefault(); event.stopPropagation(); pick(target); } } }}
            style={{ paddingInlineStart: file ? 12 : 0, paddingInlineEnd: !file && annotations.length ? 30 : 0, cursor: marking ? 'crosshair' : undefined }} data-testid="annotation-source-content">{children}</div>
        {badges.map(badge => <button key={badge.id} type="button" data-testid="annotation-badge" data-annotation-id={badge.id} aria-label={t('messageAnnotations.editNumber', { number: badge.number })} onClick={event => {
            const item = items.find(a => a.id === badge.id)!;
            const range = source.current && annotationRange(source.current, item);
            requestEdit(sessionId, item.id, file && range ? range.getBoundingClientRect() : event.currentTarget.getBoundingClientRect(), root.current, file ? moving(item) : {});
            if (file) fileAnnotationUi.update(sessionId, { activeId: item.id });
        }} style={{ ...button, position: 'absolute', ...(file ? { insetInlineStart: -14 } : { insetInlineEnd: 0 }), top: badge.top, borderRadius: file ? '8px 8px 8px 2px' : 24, padding: 0, width: 23, height: 23, background: c.button.primary.background, color: c.button.primary.tint, fontSize: 11, boxShadow: file ? `0 2px 8px ${c.shadow.color}` : undefined, zIndex: 2 }}>{String(badge.number).padStart(file ? 2 : 1, '0')}</button>)}
        {selection && !request && createPortal(<button type="button" data-testid="annotation-add" onMouseDown={event => event.preventDefault()} onClick={() => open(selection)} style={{ ...button, position: 'fixed', zIndex: 9999, left: Math.max(12, Math.min(selection.rect.left, window.innerWidth - 170)), top: Math.max(12, Math.min(selection.rect.top - 44, window.innerHeight - 48)), padding: '9px 12px', background: c.surface, border: `1px solid ${c.divider}`, boxShadow: `0 4px 20px ${c.shadow.color}` }}><Icon name="comment" />{t(file ? 'messageAnnotations.addFile' : 'messageAnnotations.add')}</button>, document.body)}
        {error && <div role="alert" style={{ color: c.textDestructive, fontSize: 12 }}>{error}</div>}
    </div>;
}

export function restoreAnnotatedMessage(sessionId: string, annotations: readonly MessageAnnotation[]) {
    annotationDraftStore.restore(sessionId, annotations);
}
export function prepareAnnotatedMessage(sessionId: string, text: string) {
    const snapshot = annotationDraftStore.getSnapshot(sessionId);
    const labels = { intro: t('messageAnnotations.promptIntro'), annotation: t('messageAnnotations.annotation'), quote: t('messageAnnotations.selectedText'), comment: t('messageAnnotations.yourComment'), explain: t('messageAnnotations.explain'), additional: t('messageAnnotations.additional'), fileInstructions: t('messageAnnotations.fileInstructions'), fileReview: t('messageAnnotations.fileReview') };
    return {
        text: formatAnnotatedMessage(text, snapshot, labels),
        displayText: formatAnnotatedMessage(text, snapshot, labels, false),
        annotations: snapshot,
        commit: () => annotationDraftStore.clearSubmitted(sessionId, snapshot),
    };
}
