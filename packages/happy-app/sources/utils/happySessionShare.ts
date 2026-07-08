import type { Session } from '@/sync/storageTypes';
import type { Message, ToolCallMessage } from '@/sync/typesMessage';
import type { AgentEvent } from '@/sync/typesRaw';

export interface BuildHappySessionShareHtmlOptions {
    sharedAt?: number;
    attachmentUrls?: Record<string, string>;
}

interface ShareAttachment {
    ref: string;
    name: string;
    size?: number;
    width?: number;
    height?: number;
    url?: string;
}

export function buildHappySessionShareHtml(
    session: Session,
    messages: Message[],
    options: BuildHappySessionShareHtmlOptions = {},
): string {
    const title = getSessionShareTitle(session);
    const sharedAt = options.sharedAt ?? Date.now();
    const body: string[] = [];
    const pendingAttachments: ShareAttachment[] = [];
    const pendingTools: string[] = [];

    for (const message of sortMessagesForShare(messages)) {
        if (message.kind === 'tool-call') {
            const attachment = parseShareAttachment(message, options.attachmentUrls);
            if (attachment) {
                flushTools(body, pendingTools);
                pendingAttachments.push(attachment);
                continue;
            }
            flushAttachments(body, pendingAttachments);
            pendingTools.push(renderToolCallHtml(message));
            continue;
        }
        flushAttachments(body, pendingAttachments);
        flushTools(body, pendingTools);
        appendMessageHtml(body, message);
    }
    flushAttachments(body, pendingAttachments);
    flushTools(body, pendingTools);

    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        `<title>${escapeHtml(title)}</title>`,
        '<meta name="robots" content="noindex">',
        '<style>',
        buildShareCss(),
        '</style>',
        '</head>',
        '<body>',
        '<main class="page">',
        '<header class="session-header">',
        '<div class="brand-row"><span class="brand-dot"></span><span>Happy Share</span></div>',
        `<h1>${escapeHtml(title)}</h1>`,
        `<p>${escapeHtml(formatSharedAt(sharedAt))}</p>`,
        '</header>',
        '<section class="timeline" aria-label="Shared session messages">',
        ...body,
        '</section>',
        '</main>',
        '</body>',
        '</html>',
    ].join('\n');
}

function appendMessageHtml(lines: string[], message: Message): void {
    switch (message.kind) {
        case 'user-text': {
            const text = (message.displayText ?? message.text).trim();
            if (text) {
                lines.push(renderMessageHtml('USER', message.createdAt, text, 'user'));
            }
            break;
        }
        case 'agent-text': {
            const text = message.text.trim();
            if (!message.isThinking && text) {
                lines.push(renderMessageHtml('ASSISTANT', message.createdAt, text, 'assistant'));
            }
            break;
        }
        case 'agent-event': {
            const text = formatAgentEvent(message.event);
            if (text) {
                lines.push(renderMessageHtml('EVENT', message.createdAt, text, 'event'));
            }
            break;
        }
        case 'tool-call':
            lines.push(renderToolGroupHtml([renderToolCallHtml(message)]));
            break;
    }
}

function renderMessageHtml(role: string, createdAt: number, text: string, tone: 'user' | 'assistant' | 'event'): string {
    return [
        `<article class="message message-${tone}">`,
        `<div class="message-meta"><strong>${escapeHtml(role)}</strong><time>${escapeHtml(formatMessageTime(createdAt))}</time></div>`,
        `<div class="message-body">${renderTextContentHtml(text)}</div>`,
        '</article>',
    ].join('\n');
}

function renderTextContentHtml(text: string): string {
    const sections = splitOptionBlocks(text);
    return sections.map((section) => {
        if (section.type === 'options') {
            return renderOptionsHtml(section.options);
        }
        return renderPlainTextHtml(section.text);
    }).join('\n');
}

function splitOptionBlocks(text: string): Array<{ type: 'text'; text: string } | { type: 'options'; options: string[] }> {
    const result: Array<{ type: 'text'; text: string } | { type: 'options'; options: string[] }> = [];
    const pattern = /<options>\s*([\s\S]*?)\s*<\/options>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const before = text.slice(lastIndex, match.index);
        if (before.trim()) {
            result.push({ type: 'text', text: before });
        }
        const options = Array.from(match[1].matchAll(/<option>\s*([\s\S]*?)\s*<\/option>/gi))
            .map(optionMatch => decodeBasicEntities(optionMatch[1].trim()))
            .filter(Boolean);
        if (options.length > 0) {
            result.push({ type: 'options', options });
        }
        lastIndex = match.index + match[0].length;
    }
    const after = text.slice(lastIndex);
    if (after.trim()) {
        result.push({ type: 'text', text: after });
    }
    return result.length > 0 ? result : [{ type: 'text', text }];
}

function renderOptionsHtml(options: string[]): string {
    return [
        '<div class="happy-options" role="group" aria-label="Options">',
        '<div class="happy-options-title">OPTIONS</div>',
        ...options.map(option => [
            '<div class="happy-option">',
            '<span class="happy-option-dot"></span>',
            `<span>${escapeHtml(option)}</span>`,
            '</div>',
        ].join('')),
        '</div>',
    ].join('\n');
}

function renderPlainTextHtml(text: string): string {
    const blocks = text.trim().split(/\n{2,}/);
    return blocks.map(block => {
        const escaped = escapeHtml(block.trim()).replace(/\n/g, '<br>');
        if (/^[-*]\s+/m.test(block)) {
            const items = block.split(/\n/).map(line => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
            if (items.length > 1) {
                return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
            }
        }
        return `<p>${escaped}</p>`;
    }).join('\n');
}

function renderToolCallHtml(message: ToolCallMessage): string {
    const tool = message.tool;
    const details: string[] = [];
    if (tool.description) {
        details.push(`<p>${escapeHtml(tool.description)}</p>`);
    }
    if (tool.input !== undefined) {
        details.push(renderCodeBlockHtml('Input', tool.input));
    }
    if (tool.result !== undefined) {
        details.push(renderCodeBlockHtml('Result', tool.result));
    }
    const children: string[] = [];
    for (const child of sortMessagesForShare(message.children)) {
        if (child.kind === 'tool-call') {
            children.push(renderToolCallHtml(child));
        } else {
            const childLines: string[] = [];
            appendMessageHtml(childLines, child);
            children.push(...childLines);
        }
    }

    return [
        '<details class="tool" open>',
        '<summary>',
        `<span>${escapeHtml(tool.name || 'Tool')}</span>`,
        `<small>${escapeHtml(tool.state)}</small>`,
        '</summary>',
        ...details,
        ...children,
        '</details>',
    ].join('\n');
}

function renderToolGroupHtml(tools: string[]): string {
    return [
        '<article class="tool-group">',
        `<div class="tool-group-title">Tool activity · ${tools.length} ${tools.length === 1 ? 'step' : 'steps'}</div>`,
        ...tools,
        '</article>',
    ].join('\n');
}

function renderCodeBlockHtml(label: string, value: unknown): string {
    return [
        '<div class="tool-payload">',
        `<span>${escapeHtml(label)}</span>`,
        `<pre>${escapeHtml(stringifyValue(value))}</pre>`,
        '</div>',
    ].join('\n');
}

function parseShareAttachment(
    message: ToolCallMessage,
    attachmentUrls: Record<string, string> | undefined,
): ShareAttachment | null {
    if (message.tool.name !== 'file' || !isObject(message.tool.input)) {
        return null;
    }
    const input = message.tool.input;
    if (typeof input.ref !== 'string' || typeof input.name !== 'string') {
        return null;
    }
    const image = isObject(input.image) ? input.image : null;
    const width = readPositiveNumber(image?.width);
    const height = readPositiveNumber(image?.height);
    if (!width || !height) {
        return null;
    }
    const size = readPositiveNumber(input.size);
    return {
        ref: input.ref,
        name: input.name,
        width,
        height,
        ...(size !== undefined ? { size } : {}),
        ...(attachmentUrls?.[input.ref] ? { url: attachmentUrls[input.ref] } : {}),
    };
}

function renderAttachmentGalleryHtml(attachments: ShareAttachment[]): string {
    return [
        '<div class="image-gallery" aria-label="Shared images">',
        ...attachments.map(renderAttachmentCardHtml),
        '</div>',
    ].join('\n');
}

function renderAttachmentCardHtml(attachment: ShareAttachment): string {
    const meta = [
        `${Math.round(attachment.width ?? 0)} x ${Math.round(attachment.height ?? 0)}`,
        formatBytes(attachment.size),
    ].filter(Boolean).join(' · ');
    const media = attachment.url
        ? `<img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name)}" loading="lazy">`
        : '<div class="image-placeholder">IMAGE</div>';
    return [
        '<figure class="image-card">',
        media,
        '<figcaption>',
        `<strong>${escapeHtml(attachment.name)}</strong>`,
        meta ? `<span>${escapeHtml(meta)}</span>` : '',
        '</figcaption>',
        '</figure>',
    ].join('\n');
}

function flushAttachments(lines: string[], attachments: ShareAttachment[]): void {
    if (attachments.length === 0) {
        return;
    }
    lines.push(renderAttachmentGalleryHtml(attachments.splice(0)));
}

function flushTools(lines: string[], tools: string[]): void {
    if (tools.length === 0) {
        return;
    }
    lines.push(renderToolGroupHtml(tools.splice(0)));
}

function sortMessagesForShare(messages: Message[]): Message[] {
    return messages
        .map((message, index) => ({ message, index }))
        .sort((a, b) => {
            const timeDiff = a.message.createdAt - b.message.createdAt;
            return timeDiff === 0 ? a.index - b.index : timeDiff;
        })
        .map(({ message }) => message);
}

function getSessionShareTitle(session: Session): string {
    return session.metadata?.summary?.text?.trim()
        || session.metadata?.name?.trim()
        || session.metadata?.path?.trim()
        || 'Happy Session';
}

function formatSharedAt(timestamp: number): string {
    return `Shared ${new Date(timestamp).toLocaleString()}`;
}

function formatMessageTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

function formatAgentEvent(event: AgentEvent): string | null {
    switch (event.type) {
        case 'switch':
            return `Switched to ${event.mode} mode.`;
        case 'message':
            return event.message;
        case 'limit-reached':
            return `Usage limit reached until ${new Date(event.endsAt).toISOString()}.`;
        case 'ready':
            return 'Agent ready.';
    }
}

function formatBytes(size: number | undefined): string | null {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
        return null;
    }
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function stringifyValue(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function readPositiveNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function decodeBasicEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function buildShareCss(): string {
    return `
:root {
  color-scheme: light;
  --bg: #ffffff;
  --text: #111827;
  --muted: #6b7280;
  --line: #dbe5f1;
  --surface: #f3f7fd;
  --surface-strong: #eaf1fb;
  --accent: #0e9ed4;
  --accent-soft: #dff5ff;
  --shadow: 0 12px 32px rgba(17, 24, 39, 0.08);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
.page { width: min(820px, 100%); margin: 0 auto; padding: 26px 18px 48px; }
.session-header { padding: 18px 4px 24px; border-bottom: 1px solid var(--line); margin-bottom: 22px; }
.brand-row { display: flex; align-items: center; gap: 8px; color: var(--accent); font-size: 13px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.brand-dot { width: 9px; height: 9px; border-radius: 50%; background: #29d66f; box-shadow: 0 0 0 5px rgba(41, 214, 111, .12); }
h1 { margin: 12px 0 8px; font-size: clamp(28px, 7vw, 48px); line-height: 1.04; letter-spacing: 0; }
.session-header p { margin: 0; color: var(--muted); font-size: 15px; }
.timeline { display: flex; flex-direction: column; gap: 24px; }
.message { width: 100%; }
.message-meta { display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px; }
.message-meta strong { color: var(--accent); font-size: 15px; letter-spacing: .08em; }
.message-meta time { color: var(--muted); font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.message-body { font-size: 22px; line-height: 1.5; overflow-wrap: anywhere; }
.message-body p { margin: 0 0 14px; }
.message-body p:last-child { margin-bottom: 0; }
.message-user .message-body { display: inline-block; max-width: 92%; padding: 14px 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; }
.message-user { text-align: right; }
.message-user .message-meta { justify-content: flex-end; }
.message-event .message-body { color: var(--muted); font-size: 17px; }
ul { margin: 0; padding-left: 24px; }
li + li { margin-top: 7px; }
.happy-options { border: 1px solid #9bd8ec; background: #e9fbff; border-radius: 12px; padding: 13px 14px 14px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .72); }
.happy-options-title { color: #086f94; font: 800 14px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .15em; margin-bottom: 10px; }
.happy-option { display: flex; align-items: flex-start; gap: 12px; min-height: 48px; padding: 12px 14px; border: 1px solid #b7dfef; background: rgba(255, 255, 255, .86); border-radius: 10px; font-size: 20px; font-weight: 760; line-height: 1.35; }
.happy-option + .happy-option { margin-top: 10px; }
.happy-option-dot { flex: 0 0 auto; width: 16px; height: 16px; margin-top: 6px; border-radius: 50%; background: #119fd4; box-shadow: 0 0 0 6px #d7f1fb; }
.image-gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
.image-card { position: relative; min-height: 280px; margin: 0; overflow: hidden; border-radius: 12px; background: #f5f7fb; border: 1px solid #dfe6ef; box-shadow: var(--shadow); }
.image-card img { width: 100%; height: 100%; min-height: 280px; object-fit: cover; display: block; }
.image-placeholder { display: grid; min-height: 280px; place-items: center; color: #6b7280; font: 800 16px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; }
.image-card figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 44px 16px 14px; color: white; background: linear-gradient(180deg, rgba(17, 24, 39, 0), rgba(17, 24, 39, .76)); }
.image-card strong, .image-card span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.image-card strong { font-size: 17px; }
.image-card span { margin-top: 4px; font-size: 14px; opacity: .86; }
.tool-group { border: 1px solid var(--line); background: var(--surface); border-radius: 14px; padding: 14px; }
.tool-group-title { font-weight: 800; color: #1f2937; margin-bottom: 8px; }
.tool { border-top: 1px solid var(--line); padding: 10px 0 0; }
.tool summary { cursor: pointer; display: flex; justify-content: space-between; gap: 12px; font-weight: 760; }
.tool summary small { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tool p { color: var(--muted); margin: 9px 0 0; }
.tool-payload { margin-top: 10px; }
.tool-payload span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 5px; }
pre { margin: 0; max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px 12px; background: rgba(255, 255, 255, .76); border: 1px solid var(--line); border-radius: 10px; font-size: 13px; line-height: 1.4; }
@media (max-width: 560px) {
  .page { padding: 18px 14px 40px; }
  .message-body { font-size: 19px; }
  .message-user .message-body { max-width: 100%; border-radius: 18px; }
  .happy-option { font-size: 18px; }
  .image-gallery { grid-template-columns: 1fr; }
}
`.trim();
}
