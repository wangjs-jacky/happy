import * as React from 'react';
import { createPortal } from 'react-dom';
import { useUnistyles } from 'react-native-unistyles';
import { WEB_DEFAULT_FONT_FAMILY } from '@/constants/Typography';
import { t } from '@/text';
import { multiplyColorOpacity } from '@/utils/colorOpacity';
import {
    buildActivityCalendar, formatActivityTokens, getActivityLevel,
    type ActivityDay, type ActivitySnapshot,
} from './codexActivityCalendar';

// Independently implemented for Paws. Rare UI's public demo informed the
// compact calendar and disclosure pattern; no Rare UI source is included.
const CELL = 13;
const GAP = 3;
const PITCH = CELL + GAP;
const LEVEL_ALPHA = [0, 0.28, 0.48, 0.72, 1];

const css = `
.paws-activity{margin:20px 12px 24px;padding:18px;border:1px solid var(--activity-border);border-radius:16px;background:var(--activity-surface);color:var(--activity-text);box-sizing:border-box;min-width:0}
.paws-activity *{box-sizing:border-box}
.paws-activity button{font-family:inherit}
.paws-activity-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.paws-activity h3{margin:0;font-size:16px;line-height:24px;font-weight:600}
.paws-activity-scope,.paws-activity-range,.paws-activity-note{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--activity-secondary)}
.paws-activity-total{text-align:right;font-size:21px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums}
.paws-activity-total small{display:block;font-size:11px;line-height:18px;color:var(--activity-secondary);font-weight:400}
.paws-activity-calendar{display:flex;gap:10px;margin-top:18px;min-width:0}
.paws-activity-weekdays{flex:0 0 27px;position:relative;margin-top:24px;height:109px;font-size:10px;color:var(--activity-secondary)}
.paws-activity-scroll{overflow-x:auto;overflow-y:hidden;min-width:0;flex:1;scrollbar-width:thin;overscroll-behavior-x:contain;padding:3px 3px 9px}
.paws-activity-grid{display:flex;gap:3px;position:relative;padding-top:21px}
.paws-activity-week{display:flex;flex-direction:column;gap:3px;flex:0 0 13px}
.paws-activity-month{position:absolute;top:0;font-size:10px;line-height:14px;white-space:nowrap;color:var(--activity-secondary)}
.paws-activity-cell{display:block;flex:0 0 13px;width:13px;height:13px;border:0;border-radius:3px;padding:0;cursor:pointer;outline-offset:1px}
.paws-activity-cell:hover{outline:1px solid var(--activity-secondary)}
.paws-activity-cell[aria-pressed=true]{outline:1px solid var(--activity-text)}
.paws-activity-cell:focus-visible{outline:2px solid var(--activity-text);outline-offset:1px}
.paws-activity-legend{display:flex;align-items:center;justify-content:flex-end;gap:4px;font-size:11px;color:var(--activity-secondary);margin-top:6px}
.paws-activity-swatch{display:inline-block;width:10px;height:10px;border-radius:2px}
.paws-activity-footer{margin-top:16px;border-radius:10px;overflow:hidden;background:var(--activity-high)}
.paws-activity-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:12px 14px;border:0;background:transparent;color:var(--activity-text);text-align:left;cursor:pointer}
.paws-activity-summary:hover{background:var(--activity-pressed)}
.paws-activity-summary:focus-visible{outline:2px solid var(--activity-text);outline-offset:-3px}
.paws-activity-summary strong{font-size:13px;line-height:20px;font-weight:600}
.paws-activity-summary small{display:block;color:var(--activity-secondary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.paws-activity-toggle{font-size:12px;white-space:nowrap;color:var(--activity-secondary)}
.paws-activity-details{padding:0 14px 14px;border-top:1px solid var(--activity-border)}
.paws-activity-details dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:14px 0}
.paws-activity-details dt{font-size:12px;line-height:18px;color:var(--activity-secondary)}
.paws-activity-details dd{margin:4px 0 0;font-size:18px;line-height:24px;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.paws-activity-tooltip{box-sizing:border-box;position:fixed;z-index:100000;pointer-events:none;width:max-content;max-width:min(246px,calc(100vw - 16px));padding:8px 11px;border:1px solid var(--activity-border);border-radius:8px;background:var(--activity-high);color:var(--activity-text);font-family:inherit;font-size:12px;line-height:18px;box-shadow:0 4px 18px var(--activity-shadow)}
.paws-activity-tooltip strong{display:block;font-size:12px}
@media(max-width:520px){.paws-activity{padding:14px}.paws-activity-total{text-align:left;font-size:18px}.paws-activity-header{gap:10px}.paws-activity-details dl{grid-template-columns:1fr}.paws-activity-details dl>div{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.paws-activity-details dd{margin:0;font-size:16px}}
`;

export function CodexActivityHeatmap({ snapshot, language }: {
    snapshot: ActivitySnapshot | null;
    language: string;
}) {
    const { theme } = useUnistyles();
    const calendar = React.useMemo(() => buildActivityCalendar(snapshot), [snapshot]);
    const [chosenDate, setChosenDate] = React.useState<string | null>(null);
    const [focusDate, setFocusDate] = React.useState<string | null>(null);
    const [expanded, setExpanded] = React.useState(false);
    const [preview, setPreview] = React.useState<{ date: string; left: number; top: number } | null>(null);
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const initialized = React.useRef(false);
    const dismissEscape = React.useRef(false);
    const cells = React.useRef(new Map<string, HTMLButtonElement>());
    const detailId = React.useId();
    const tooltipId = React.useId();
    const fallback = [...calendar.days].reverse().find(day => day.totalTokens > 0) ?? calendar.days.at(-1);
    const selected = calendar.days.find(day => day.date === chosenDate) ?? fallback;
    const previewDay = calendar.days.find(day => day.date === preview?.date);
    const tabDate = calendar.days.some(day => day.date === focusDate) ? focusDate : selected?.date;
    const locale = language === 'zh-Hans' ? 'zh-CN' : language === 'zh-Hant' ? 'zh-TW' : language;
    const monthFormatter = React.useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }), [locale]);
    const weekdayFormatter = React.useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }), [locale]);
    const variables = {
        '--activity-surface': theme.colors.surface,
        '--activity-high': theme.colors.surfaceHigh,
        '--activity-pressed': theme.colors.surfacePressed,
        '--activity-border': theme.colors.divider,
        '--activity-text': theme.colors.text,
        '--activity-secondary': theme.colors.textSecondary,
        '--activity-shadow': multiplyColorOpacity(theme.colors.shadow.color, theme.colors.shadow.opacity),
        fontFamily: WEB_DEFAULT_FONT_FAMILY,
    } as React.CSSProperties;
    const dayLabel = (day: ActivityDay) => t('machine.codexUsageHeatmapDay', {
        date: day.date, tokens: formatActivityTokens(day.totalTokens, language, true), sessions: day.sessions,
    });
    const background = (level: number) => level
        ? multiplyColorOpacity(theme.colors.accent, LEVEL_ALPHA[level])
        : theme.colors.surfaceHigh;

    React.useLayoutEffect(() => {
        // Do not reset the reader's position when new data arrives or the
        // dialog changes size. A new machine mounts a new keyed component.
        if (initialized.current || !calendar.days.length || !scrollRef.current) return;
        scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        initialized.current = true;
    }, [calendar.days.length]);

    React.useEffect(() => {
        const clear = () => setPreview(null);
        // RN Web's parent Modal closes on keyup. Dismissing a tooltip on
        // keydown must consume that same keyup, rather than closing both layers.
        const consumeKeyUp = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || !dismissEscape.current) return;
            dismissEscape.current = false;
            event.preventDefault();
            event.stopPropagation();
        };
        window.addEventListener('scroll', clear, true);
        window.addEventListener('resize', clear);
        document.addEventListener('keyup', consumeKeyUp, true);
        return () => {
            window.removeEventListener('scroll', clear, true);
            window.removeEventListener('resize', clear);
            document.removeEventListener('keyup', consumeKeyUp, true);
        };
    }, []);

    const showPreview = (day: ActivityDay, element: HTMLButtonElement) => {
        const rect = element.getBoundingClientRect();
        setPreview({
            date: day.date,
            left: Math.max(8, Math.min(window.innerWidth - 254, rect.left - 90)),
            top: rect.top > 72 ? rect.top - 62 : rect.bottom + 8,
        });
    };
    const navigate = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
        const moves: Record<string, number> = {
            ArrowLeft: index - 7, ArrowRight: index + 7,
            ArrowUp: index - 1, ArrowDown: index + 1,
            Home: 0, End: calendar.days.length - 1,
        };
        if (event.key === 'Escape' && previewDay) {
            dismissEscape.current = true;
            event.preventDefault();
            event.stopPropagation();
            setPreview(null);
            return;
        }
        const target = moves[event.key];
        if (target === undefined) return;
        event.preventDefault();
        const day = calendar.days[Math.max(0, Math.min(calendar.days.length - 1, target))];
        setFocusDate(day.date);
        cells.current.get(day.date)?.focus();
    };

    if (!calendar.days.length || !selected) return null;
    const warningCount = (snapshot as ActivitySnapshot & { warnings?: unknown[] })?.warnings?.length ?? 0;
    return (
        <section className="paws-activity" style={variables} aria-label={t('machine.codexUsageHeatmap')} data-testid="codex-activity">
            <style>{css}</style>
            <header className="paws-activity-header">
                <div>
                    <h3>{t('machine.codexUsageHeatmap')}</h3>
                    <p className="paws-activity-scope">{t('codexActivity.scope')}</p>
                    <p className="paws-activity-range">{calendar.from} – {calendar.to}</p>
                </div>
                <div className="paws-activity-total" title={formatActivityTokens(calendar.total, language, true)}>
                    {formatActivityTokens(calendar.total, language)}
                    <small>{t('codexActivity.processed')}</small>
                </div>
            </header>
            <div className="paws-activity-calendar">
                <div className="paws-activity-weekdays" aria-hidden="true">
                    {[1, 3, 5].map(weekday => <span key={weekday} style={{ position: 'absolute', top: weekday * PITCH }}>
                        {weekdayFormatter.format(new Date(Date.UTC(2026, 0, 4 + weekday)))}
                    </span>)}
                </div>
                <div ref={scrollRef} className="paws-activity-scroll" data-testid="codex-usage-heatmap-scroll">
                    <div className="paws-activity-grid" style={{ width: calendar.weeks.length * PITCH - GAP }} data-testid="codex-usage-heatmap">
                        {calendar.months.filter((month, index, months) => index === months.length - 1 || (months[index + 1].weekIndex - month.weekIndex) * PITCH >= 28).map(month => (
                            <span className="paws-activity-month" key={month.key} style={{ left: month.weekIndex * PITCH }}>
                                {monthFormatter.format(new Date(`${month.date}T00:00:00Z`))}
                            </span>
                        ))}
                        {calendar.weeks.map((week, column) => <div className="paws-activity-week" key={column}>
                            {week.map((day, row) => day ? (
                                <button
                                    type="button"
                                    className="paws-activity-cell"
                                    key={day.date}
                                    ref={element => { if (element) cells.current.set(day.date, element); else cells.current.delete(day.date); }}
                                    data-testid={`codex-usage-day-${day.date}`}
                                    data-level={getActivityLevel(day.totalTokens, calendar.max)}
                                    style={{ backgroundColor: background(getActivityLevel(day.totalTokens, calendar.max)) }}
                                    tabIndex={day.date === tabDate ? 0 : -1}
                                    aria-pressed={day.date === selected.date}
                                    aria-label={dayLabel(day)}
                                    aria-describedby={previewDay?.date === day.date ? tooltipId : undefined}
                                    onMouseEnter={event => showPreview(day, event.currentTarget)}
                                    onMouseLeave={event => { if (document.activeElement !== event.currentTarget) setPreview(null); }}
                                    onFocus={event => { setFocusDate(day.date); showPreview(day, event.currentTarget); }}
                                    onBlur={() => setPreview(null)}
                                    onKeyDown={event => navigate(event, column * 7 + row - (7 - calendar.weeks[0].filter(Boolean).length))}
                                    onClick={() => { setChosenDate(day.date); setFocusDate(day.date); }}
                                />
                            ) : <span key={`padding-${row}`} aria-hidden="true" style={{ width: CELL, height: CELL }} />)}
                        </div>)}
                    </div>
                </div>
            </div>
            <div className="paws-activity-legend" aria-label={t('machine.codexUsageHeatmapLegend')}>
                <span>{t('machine.codexUsageHeatmapLegend')}</span>
                {LEVEL_ALPHA.map((_, level) => <span key={level} className="paws-activity-swatch" style={{ background: background(level) }} />)}
            </div>
            <div className="paws-activity-footer">
                <button className="paws-activity-summary" type="button" aria-expanded={expanded} aria-controls={detailId} aria-label={`${dayLabel(selected)}. ${expanded ? t('codexActivity.hideDetails') : t('codexActivity.showDetails')}`} onClick={() => setExpanded(value => !value)} data-testid="codex-activity-details-toggle">
                    <span><strong>{selected.date}</strong><small>{formatActivityTokens(selected.totalTokens, language)} token · {selected.sessions} {t('machine.codexUsageSessions')}</small></span>
                    <span className="paws-activity-toggle">{expanded ? t('codexActivity.hideDetails') : t('codexActivity.showDetails')}</span>
                </button>
                {expanded && <div className="paws-activity-details" id={detailId} data-testid="codex-usage-detail">
                    <dl>{([
                        [t('codexActivity.uncachedInput'), Math.max(0, selected.inputTokens - selected.cachedInputTokens)],
                        [t('codexActivity.cacheRead'), selected.cachedInputTokens],
                        [t('codexActivity.output'), selected.outputTokens],
                    ] as const).map(([label, tokens]) => <div key={label}>
                        <dt>{label}</dt><dd title={formatActivityTokens(tokens, language, true)}>{formatActivityTokens(tokens, language)}</dd>
                    </div>)}</dl>
                    <p className="paws-activity-note">{t('codexActivity.total')}: {formatActivityTokens(selected.totalTokens, language, true)} token</p>
                    <p className="paws-activity-note">{t('codexActivity.cacheNote')}</p>
                </div>}
            </div>
            {snapshot && <p className="paws-activity-note">
                {t('machine.codexUsageScannedAt')}: {new Date(snapshot.scannedAt).toLocaleString(locale, { timeZone: snapshot.timeZone })}{snapshot.timeZone ? ` · ${snapshot.timeZone}` : ''}
            </p>}
            {warningCount > 0 && <p role="status" className="paws-activity-note">{t('codexActivity.incomplete')}</p>}
            {calendar.total === 0 && <p className="paws-activity-note">{t('codexActivity.noActivity')}</p>}
            {preview && previewDay && typeof document !== 'undefined' && createPortal(
                <div role="tooltip" id={tooltipId} className="paws-activity-tooltip" style={{ ...variables, left: preview.left, top: preview.top }}>
                    <strong>{previewDay.date}</strong>{dayLabel(previewDay)}
                </div>, document.body,
            )}
        </section>
    );
}
