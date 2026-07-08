import type { Session } from '@/sync/storageTypes';
import type { Message, ToolCallMessage } from '@/sync/typesMessage';
import type { AgentEvent } from '@/sync/typesRaw';
import { buildResumeCommandBlock } from '@/utils/resumeCommand';

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

    const resumeBlock = !session.active
        ? buildResumeCommandBlock({
            path: session.metadata?.path,
            os: session.metadata?.os,
            flavor: session.metadata?.flavor,
            claudeSessionId: session.metadata?.claudeSessionId,
            codexThreadId: session.metadata?.codexThreadId,
        })
        : null;
    const chromeLabel = formatShellLabel(session);

    return [
        '<!doctype html>',
        '<html lang="zh-CN">',
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
        '<main class="app-shell">',
        '<header class="app-topbar" aria-label="Happy session header">',
        '<span class="app-menu" aria-hidden="true"></span>',
        `<div class="app-machine"><strong>${escapeHtml(session.metadata?.flavor || 'codex')}</strong><span></span><em>${escapeHtml(chromeLabel)}</em></div>`,
        '<span class="app-new" aria-hidden="true"></span>',
        '</header>',
        '<section class="timeline" aria-label="Shared session messages">',
        ...body,
        resumeBlock ? renderInactiveSessionHtml(resumeBlock.lines, session.activeAt || session.updatedAt || sharedAt) : '',
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
    const content = tone === 'user'
        ? renderUserTextContentHtml(text)
        : renderTextContentHtml(text);
    return [
        `<article class="message message-${tone}">`,
        `<div class="message-meta"><strong>${escapeHtml(role)}</strong><time>${escapeHtml(formatMessageTime(createdAt))}</time></div>`,
        `<div class="message-body">${content}</div>`,
        '</article>',
    ].join('\n');
}

function renderUserTextContentHtml(text: string): string {
    const trimmed = text.trim();
    if (!shouldFoldPrompt(trimmed)) {
        return renderTextContentHtml(trimmed);
    }

    const lines = trimmed.split(/\r?\n/);
    const firstMeaningfulIndex = lines.findIndex(line => line.trim().length > 0);
    const intro = firstMeaningfulIndex >= 0 ? lines[firstMeaningfulIndex].trim() : '';
    const rest = lines
        .slice(firstMeaningfulIndex + 1)
        .join('\n')
        .trim();
    const foldedText = rest || trimmed;
    const lineCount = foldedText.split(/\r?\n/).filter(line => line.trim()).length;
    const charCount = foldedText.length;

    return [
        intro && rest ? `<p>${formatInlineHtml(intro)}</p>` : '',
        '<details class="prompt-fold" open>',
        '<summary>',
        '<span class="prompt-fold-icon" aria-hidden="true"></span>',
        '<span><strong>提示词已折叠</strong>',
        `<em>${lineCount} 行 · ${charCount} 字符</em></span>`,
        '<b>复制　收起⌃</b>',
        '</summary>',
        `<div class="prompt-fold-body">${renderTextContentHtml(foldedText)}</div>`,
        '</details>',
    ].filter(Boolean).join('\n');
}

function shouldFoldPrompt(text: string): boolean {
    if (text.length > 1200) {
        return true;
    }
    return /(?:使用\s+\$gpt-image|生成锁|推荐续生成选项|prompt|style_id)/i.test(text) && text.length > 300;
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
    if (options.length >= 3 && options.every(isGptImageStyleOption)) {
        return [
            '<div class="style-options" role="group" aria-label="GPT Image style options">',
            ...options.map(option => `<div class="style-option">${escapeHtml(readGptImageStyleLabel(option))}</div>`),
            '</div>',
        ].join('\n');
    }

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

function isGptImageStyleOption(option: string): boolean {
    return /^\s*\[\[gpt-image-style:[^\]]+\]\]/.test(option);
}

function readGptImageStyleLabel(option: string): string {
    return option.replace(/^\s*\[\[gpt-image-style:[^\]]+\]\]\s*/, '').trim() || option;
}

function renderPlainTextHtml(text: string): string {
    const blocks = text.trim().split(/\n{2,}/);
    return blocks.map(block => {
        const escaped = block.trim().split(/\n/).map(line => formatInlineHtml(line.trim())).join('<br>');
        if (/^[-*]\s+/m.test(block)) {
            const items = block.split(/\n/).map(line => line.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
            if (items.length > 1) {
                return `<ul>${items.map(item => `<li>${formatInlineHtml(item)}</li>`).join('')}</ul>`;
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
        '<details class="tool">',
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
    const count = tools.length;
    return [
        '<details class="tool-group">',
        '<summary>',
        '<strong>Tool activity</strong>',
        `<span>${count} ${count === 1 ? 'step' : 'steps'} collapsed</span>`,
        '</summary>',
        '<div class="tool-list">',
        ...tools,
        '</div>',
        '</details>',
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
    const mode = attachments.length === 1 ? 'single' : 'grid';
    return [
        `<div class="image-gallery image-gallery-${mode}" aria-label="Shared images">`,
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
    const aspect = formatAspectRatio(attachment);
    return [
        `<figure class="image-card" style="aspect-ratio:${aspect}">`,
        media,
        '<figcaption>',
        `<strong>${escapeHtml(attachment.name)}</strong>`,
        meta ? `<span>${escapeHtml(meta)}</span>` : '',
        '</figcaption>',
        '</figure>',
    ].join('\n');
}

function formatAspectRatio(attachment: ShareAttachment): string {
    if (!attachment.width || !attachment.height) {
        return '4 / 3';
    }
    const ratio = attachment.width / attachment.height;
    const clamped = Math.max(0.65, Math.min(1.8, ratio));
    return `${Math.round(clamped * 1000) / 1000}`;
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

function formatShellLabel(session: Session): string {
    return session.metadata?.host?.trim()
        || session.metadata?.path?.split('/').filter(Boolean).pop()
        || 'shared';
}

function renderInactiveSessionHtml(commandLines: string[], activeAt: number): string {
    return [
        '<section class="inactive-session">',
        '<p>此会话处于非活动状态。</p>',
        '<p>要从终端恢复它：</p>',
        '<pre><code>',
        escapeHtml(commandLines.join('\n')),
        '</code></pre>',
        `<p class="inactive-time">最后活跃时间 ${escapeHtml(formatRelativeTime(activeAt))}</p>`,
        '</section>',
    ].join('\n');
}

function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    if (!Number.isFinite(diff) || diff < 0) {
        return new Date(timestamp).toLocaleString();
    }
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < hour) {
        return `${Math.max(1, Math.round(diff / minute))} 分钟前`;
    }
    if (diff < day) {
        return `${Math.round(diff / hour)} 小时前`;
    }
    return `${Math.round(diff / day)} 天前`;
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

function formatInlineHtml(value: string): string {
    return escapeHtml(value)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
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
  --shadow: 0 8px 22px rgba(17, 24, 39, 0.08);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
.app-shell { width: min(900px, 100%); margin: 0 auto; padding: 14px 18px 40px; }
.app-topbar { position: sticky; top: 0; z-index: 3; display: grid; grid-template-columns: 46px minmax(0, 1fr) 46px; align-items: center; gap: 10px; min-height: 68px; padding: 8px 0 14px; background: rgba(255, 255, 255, .94); backdrop-filter: blur(18px); }
.app-menu, .app-new { width: 28px; height: 28px; justify-self: center; position: relative; }
.app-menu:before, .app-menu:after, .app-new:before, .app-new:after { content: ""; position: absolute; background: #2f2219; border-radius: 999px; }
.app-menu:before { left: 3px; right: 3px; top: 7px; height: 3px; box-shadow: 0 7px 0 #2f2219, 0 14px 0 #2f2219; }
.app-new:before { inset: 4px; border: 3px solid #2f2219; background: transparent; border-radius: 3px; }
.app-new:after { right: 2px; top: 2px; width: 11px; height: 3px; box-shadow: 4px 4px 0 #2f2219; transform: rotate(90deg); }
.app-machine { min-width: 0; justify-self: center; display: flex; align-items: center; justify-content: center; gap: 8px; width: min(460px, 100%); padding: 9px 18px; border: 1px solid #edf0f4; border-radius: 999px; background: rgba(255, 255, 255, .82); box-shadow: 0 1px 7px rgba(15, 23, 42, .04); }
.app-machine strong { font-size: 17px; letter-spacing: .03em; }
.app-machine span { width: 8px; height: 8px; border-radius: 999px; background: #9ca3af; }
.app-machine em { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #667085; font-style: normal; font: 16px ui-monospace, SFMono-Regular, Menlo, monospace; }
.timeline { display: flex; flex-direction: column; gap: 20px; padding-top: 6px; }
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
.happy-options { text-align: left; border: 1px solid #9bd8ec; background: #e9fbff; border-radius: 12px; padding: 13px 14px 14px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .72); }
.happy-options-title { color: #086f94; font: 800 14px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .15em; margin-bottom: 10px; }
.happy-option { display: flex; align-items: flex-start; gap: 12px; min-height: 48px; padding: 12px 14px; border: 1px solid #b7dfef; background: rgba(255, 255, 255, .86); border-radius: 10px; font-size: 20px; font-weight: 760; line-height: 1.35; }
.happy-option + .happy-option { margin-top: 10px; }
.happy-option-dot { flex: 0 0 auto; width: 16px; height: 16px; margin-top: 6px; border-radius: 50%; background: #119fd4; box-shadow: 0 0 0 6px #d7f1fb; }
.style-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 12px 0 4px; text-align: left; }
.style-option { display: flex; align-items: center; min-height: 62px; padding: 10px 16px; border: 1px solid #e2d7c7; border-radius: 10px; background: #eaf1f7; color: #1f2d3d; font-size: 19px; line-height: 1.22; font-weight: 760; }
.image-gallery { display: grid; gap: 14px; }
.image-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.image-gallery-single { grid-template-columns: minmax(0, 1fr); }
.image-card { position: relative; margin: 0; overflow: hidden; border-radius: 14px; background: #f5f7fb; border: 1px solid #dfe6ef; box-shadow: var(--shadow); }
.image-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.image-gallery-single .image-card { max-height: 560px; }
.image-gallery-single .image-card img { object-fit: contain; background: #fff; }
.image-placeholder { display: grid; width: 100%; height: 100%; min-height: 260px; place-items: center; color: #6b7280; font: 800 16px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; }
.image-card figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 46px 16px 14px; color: white; background: linear-gradient(180deg, rgba(17, 24, 39, 0), rgba(17, 24, 39, .72)); }
.image-card strong, .image-card span { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.image-card strong { font-size: 17px; }
.image-card span { margin-top: 4px; font-size: 14px; opacity: .86; }
.prompt-fold { margin-top: 8px; text-align: left; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: #eef4fb; }
.prompt-fold summary { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px 14px; cursor: pointer; list-style: none; }
.prompt-fold summary::-webkit-details-marker { display: none; }
.prompt-fold-icon { width: 24px; height: 28px; border: 2px solid #7c8a98; border-radius: 4px; position: relative; }
.prompt-fold-icon:after { content: ""; position: absolute; right: -2px; top: -2px; border-left: 8px solid transparent; border-bottom: 8px solid #7c8a98; }
.prompt-fold strong { display: block; color: #1f2937; font-size: 21px; line-height: 1.15; }
.prompt-fold em { display: block; margin-top: 2px; color: #7c8794; font-style: normal; font-size: 16px; }
.prompt-fold b { color: #71808f; font-size: 16px; font-weight: 650; white-space: nowrap; }
.prompt-fold-body { padding: 13px 16px 16px; border-top: 1px solid var(--line); color: #697586; font-size: 18px; line-height: 1.55; }
.prompt-fold-body code, .message-body code { padding: 2px 6px; border-radius: 7px; background: #edf3f8; color: #1d394d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .88em; }
.tool-group { border: 1px solid var(--line); background: var(--surface); border-radius: 14px; overflow: hidden; }
.tool-group summary { cursor: pointer; display: grid; gap: 4px; padding: 17px 22px; list-style: none; }
.tool-group summary::-webkit-details-marker, .tool summary::-webkit-details-marker { display: none; }
.tool-group summary strong { color: #1f2937; font-size: 18px; }
.tool-group summary span { color: #6b7280; font-size: 15px; font-weight: 700; }
.tool-list { padding: 14px; border-top: 1px solid var(--line); }
.tool { border-top: 1px solid var(--line); padding: 10px 0 0; }
.tool:first-child { border-top: 0; padding-top: 0; }
.tool summary { cursor: pointer; display: flex; justify-content: space-between; gap: 12px; font-weight: 760; list-style: none; }
.tool summary small { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tool p { color: var(--muted); margin: 9px 0 0; }
.tool-payload { margin-top: 10px; }
.tool-payload span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; margin-bottom: 5px; }
pre { margin: 0; max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px 12px; background: rgba(255, 255, 255, .76); border: 1px solid var(--line); border-radius: 10px; font-size: 13px; line-height: 1.4; }
.inactive-session { color: #5b6573; font-size: 20px; line-height: 1.45; }
.inactive-session p { margin: 0 0 8px; }
.inactive-session pre { margin-top: 12px; padding: 18px 22px; border: 0; border-radius: 18px; background: #eef4fd; color: #172233; font: 20px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: none; }
.inactive-time { margin-top: 14px !important; color: #99a1ad; font-size: 17px; }
 @media (max-width: 560px) {
  .app-shell { padding: 8px 18px 40px; }
  .app-topbar { grid-template-columns: 38px minmax(0, 1fr) 38px; min-height: 66px; }
  .app-machine { padding: 8px 14px; }
  .app-machine strong { font-size: 15px; }
  .app-machine em { font-size: 14px; }
  .message-body { font-size: 19px; }
  .message-user .message-body { max-width: 100%; border-radius: 18px; }
  .happy-option { font-size: 18px; }
  .style-options { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .style-option { min-height: 56px; padding: 9px 12px; font-size: 17px; }
  .image-gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .prompt-fold summary { grid-template-columns: 30px minmax(0, 1fr); }
  .prompt-fold summary b { display: none; }
  .prompt-fold strong { font-size: 18px; }
  .prompt-fold em { font-size: 14px; }
  .inactive-session pre { font-size: 17px; }
}
`.trim();
}
