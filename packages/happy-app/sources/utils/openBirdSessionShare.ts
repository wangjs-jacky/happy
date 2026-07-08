import type { Session } from '@/sync/storageTypes';
import type { Message, ToolCallMessage } from '@/sync/typesMessage';
import type { AgentEvent } from '@/sync/typesRaw';
import {
    formatOtaPreviewIdentity,
    formatOtaPreviewLabel,
    parseOtaPreviewSection,
} from '@/utils/sessionOtaPreviews';

export const OPENBIRD_API_BASE_URL = 'https://openbird.jhao.space';

export interface OpenBirdPublishResult {
    url: string;
    slug?: string;
    expiresAt?: string;
}

export interface BuildOpenBirdSessionMarkdownOptions {
    sharedAt?: number;
    attachmentUrls?: Record<string, string>;
}

export interface PublishOpenBirdTempPageOptions {
    apiBaseUrl?: string;
}

interface ShareAttachment {
    id: string;
    ref: string;
    name: string;
    size?: number;
    width?: number;
    height?: number;
    url?: string;
}

export function buildOpenBirdSessionMarkdown(
    session: Session,
    messages: Message[],
    options: BuildOpenBirdSessionMarkdownOptions = {},
): string {
    const sharedAt = options.sharedAt ?? Date.now();
    const lines: string[] = [];

    lines.push(`# ${headingText(getSessionShareTitle(session))}`);
    lines.push('');
    lines.push(buildShareStyleBlock());
    lines.push('');
    lines.push(buildThemeToggleHtml());
    lines.push('');
    lines.push('<section class="happy-share-intro">');
    lines.push(`<p>Shared from Happy on ${escapeHtml(new Date(sharedAt).toISOString())}.</p>`);
    lines.push('</section>');
    lines.push('');
    lines.push(buildSessionMetaHtml(session));
    lines.push('');
    lines.push('<hr class="happy-share-rule">');
    lines.push('');

    const sortedMessages = sortMessagesForShare(messages);
    const pendingTools: string[] = [];
    const pendingAttachments: ShareAttachment[] = [];
    for (const message of sortedMessages) {
        if (message.kind === 'tool-call') {
            const attachment = parseShareAttachment(message, options.attachmentUrls);
            if (attachment) {
                flushToolGroup(lines, pendingTools);
                pendingAttachments.push(attachment);
                continue;
            }
            flushAttachmentGallery(lines, pendingAttachments);
            pendingTools.push(renderToolCallHtml(message));
            continue;
        }
        flushAttachmentGallery(lines, pendingAttachments);
        flushToolGroup(lines, pendingTools);
        appendMessageHtml(lines, message);
    }
    flushAttachmentGallery(lines, pendingAttachments);
    flushToolGroup(lines, pendingTools);

    return trimTrailingBlankLines(lines).join('\n') + '\n';
}

export function hasOpenBirdShareContent(messages: Message[]): boolean {
    return messages.some(hasRenderableMessageContent);
}

export async function publishOpenBirdTempPage(
    markdown: string,
    options: PublishOpenBirdTempPageOptions = {},
): Promise<OpenBirdPublishResult> {
    const apiBaseUrl = (options.apiBaseUrl ?? OPENBIRD_API_BASE_URL).replace(/\/+$/, '');
    const response = await fetch(`${apiBaseUrl}/api/v1/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, temp: true }),
    });

    const data = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
        throw new Error(readOpenBirdError(data) ?? `OpenBird publish failed (${response.status})`);
    }
    if (!isObject(data) || typeof data.url !== 'string' || data.url.length === 0) {
        throw new Error('OpenBird did not return a share URL.');
    }

    return {
        url: data.url,
        ...(typeof data.slug === 'string' ? { slug: data.slug } : {}),
        ...(typeof data.expiresAt === 'string' ? { expiresAt: data.expiresAt } : {}),
    };
}

function appendMessageHtml(lines: string[], message: Message): void {
    if (!hasRenderableMessageContent(message)) {
        return;
    }

    switch (message.kind) {
        case 'user-text': {
            lines.push(renderTurnHtml('User', message.createdAt, message.displayText ?? message.text, 'user'));
            break;
        }
        case 'agent-text': {
            if (message.isThinking) {
                return;
            }
            lines.push(renderTurnHtml('Assistant', message.createdAt, message.text, 'assistant'));
            break;
        }
        case 'tool-call': {
            lines.push(renderToolGroupHtml([renderToolCallHtml(message)]));
            break;
        }
        case 'agent-event': {
            const text = formatAgentEvent(message.event);
            if (!text) {
                return;
            }
            lines.push(renderTurnHtml('Event', message.createdAt, text, 'event'));
            break;
        }
    }
}

function renderToolCallHtml(message: ToolCallMessage): string {
    const { tool } = message;
    const lines: string[] = [];
    lines.push('<div class="happy-tool">');
    lines.push('<div class="happy-tool-head">');
    lines.push(`<span class="happy-tool-name">${escapeHtml(oneLine(tool.name) || 'Tool')}</span>`);
    lines.push(`<span class="happy-tool-state">${escapeHtml(tool.state)}</span>`);
    lines.push(`<time>${escapeHtml(formatMessageTime(message.createdAt))}</time>`);
    lines.push('</div>');
    if (tool.description) {
        lines.push(`<p class="happy-tool-description">${escapeHtml(tool.description.trim())}</p>`);
    }
    if (tool.permission) {
        lines.push(`<p class="happy-tool-permission">Permission: ${escapeHtml(tool.permission.status)}</p>`);
    }
    if (tool.input !== undefined) {
        lines.push(renderToolPayloadHtml('Input', stringifyForMarkdown(tool.input)));
    }
    if (tool.result !== undefined) {
        lines.push(renderToolPayloadHtml('Result', stringifyForMarkdown(tool.result)));
    }
    for (const child of sortMessagesForShare(message.children)) {
        if (child.kind === 'tool-call') {
            lines.push(renderToolCallHtml(child));
        } else if (hasRenderableMessageContent(child)) {
            lines.push('<div class="happy-tool-child">');
            appendMessageHtml(lines, child);
            lines.push('</div>');
        }
    }
    lines.push('</div>');
    return lines.join('\n');
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
    const width = typeof image?.width === 'number' && Number.isFinite(image.width) ? image.width : undefined;
    const height = typeof image?.height === 'number' && Number.isFinite(image.height) ? image.height : undefined;
    const size = typeof input.size === 'number' && Number.isFinite(input.size) ? input.size : undefined;
    const url = attachmentUrls?.[input.ref];

    return {
        id: message.id,
        ref: input.ref,
        name: input.name,
        ...(size !== undefined ? { size } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(url ? { url } : {}),
    };
}

function renderAttachmentGalleryHtml(attachments: ShareAttachment[]): string {
    return [
        '<div class="happy-image-gallery happy-image-gallery-compact" aria-label="Shared images">',
        ...attachments.map(renderAttachmentCardHtml),
        '</div>',
    ].join('\n');
}

function renderAttachmentCardHtml(attachment: ShareAttachment): string {
    const dimensions = formatDimensions(attachment);
    const meta = [dimensions, formatBytes(attachment.size)].filter(Boolean).join(' · ');
    const aspect = getShareImageAspectRatio(attachment);
    const media = attachment.url
        ? `<img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name)}" loading="lazy">`
        : [
            '<div class="happy-image-placeholder">',
            '<span>Image</span>',
            '</div>',
        ].join('');

    return [
        `<figure class="happy-image-card" style="aspect-ratio:${aspect}">`,
        media,
        '<figcaption>',
        `<strong>${escapeHtml(attachment.name)}</strong>`,
        meta ? `<span>${escapeHtml(meta)}</span>` : '',
        '</figcaption>',
        '</figure>',
    ].join('\n');
}

function formatDimensions(attachment: ShareAttachment): string | null {
    if (!attachment.width || !attachment.height) {
        return null;
    }
    return `${Math.round(attachment.width)} x ${Math.round(attachment.height)}`;
}

function getShareImageAspectRatio(attachment: ShareAttachment): string {
    if (!attachment.width || !attachment.height) {
        return '1';
    }
    const ratio = attachment.width / attachment.height;
    const clamped = Math.max(0.72, Math.min(1.45, ratio));
    return String(Math.round(clamped * 1000) / 1000);
}

function formatBytes(size: number | undefined): string | null {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
        return null;
    }
    if (size < 1024) {
        return `${Math.round(size)} B`;
    }
    if (size < 1024 * 1024) {
        return `${Math.round(size / 1024)} KB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function hasRenderableMessageContent(message: Message): boolean {
    switch (message.kind) {
        case 'user-text':
            return (message.displayText ?? message.text).trim().length > 0;
        case 'agent-text':
            return !message.isThinking && message.text.trim().length > 0;
        case 'tool-call':
            return true;
        case 'agent-event':
            return Boolean(formatAgentEvent(message.event));
    }
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

function formatMessageTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
}

function formatAgentEvent(event: AgentEvent): string | null {
    if (!isObject(event) || typeof event.type !== 'string') {
        return null;
    }
    switch (event.type) {
        case 'switch':
            return typeof event.mode === 'string' ? `Switched to ${event.mode} mode.` : null;
        case 'message':
            return typeof event.message === 'string' ? event.message : null;
        case 'limit-reached':
            return typeof event.endsAt === 'number' ? `Usage limit reached until ${new Date(event.endsAt).toISOString()}.` : 'Usage limit reached.';
        case 'ready':
            return 'Agent ready.';
        default:
            return null;
    }
}

function headingText(value: string): string {
    const text = oneLine(value);
    return text.replace(/^#+\s*/, '') || 'Happy Session Snapshot';
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function stringifyForMarkdown(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function readOpenBirdError(data: unknown): string | null {
    if (isObject(data)) {
        if (typeof data.error === 'string' && data.error.length > 0) {
            return data.error;
        }
        if (typeof data.message === 'string' && data.message.length > 0) {
            return data.message;
        }
    }
    return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function trimTrailingBlankLines(lines: string[]): string[] {
    let end = lines.length;
    while (end > 0 && lines[end - 1] === '') {
        end -= 1;
    }
    return lines.slice(0, end);
}

function flushToolGroup(lines: string[], pendingTools: string[]): void {
    if (pendingTools.length === 0) {
        return;
    }
    lines.push(renderToolGroupHtml(pendingTools));
    lines.push('');
    pendingTools.length = 0;
}

function flushAttachmentGallery(lines: string[], pendingAttachments: ShareAttachment[]): void {
    if (pendingAttachments.length === 0) {
        return;
    }
    lines.push(renderAttachmentGalleryHtml(pendingAttachments));
    lines.push('');
    pendingAttachments.length = 0;
}

function renderToolGroupHtml(tools: string[]): string {
    const count = tools.length;
    return [
        '<details class="happy-tool-group">',
        `<summary><span>Tool activity</span><strong>${count} ${count === 1 ? 'step' : 'steps'} collapsed</strong></summary>`,
        '<div class="happy-tool-list">',
        tools.join('\n'),
        '</div>',
        '</details>',
    ].join('\n');
}

function renderTurnHtml(label: string, timestamp: number, text: string, kind: 'user' | 'assistant' | 'event'): string {
    const body = kind === 'user' ? formatUserTextHtml(text) : formatTextHtml(text);
    return [
        `<section class="happy-turn happy-turn-${kind}">`,
        '<div class="happy-turn-meta">',
        `<span>${escapeHtml(label)}</span>`,
        `<time>${escapeHtml(formatMessageTime(timestamp))}</time>`,
        '</div>',
        `<div class="happy-turn-body">${body}</div>`,
        '</section>',
    ].join('\n');
}

function formatUserTextHtml(text: string): string {
    const source = text.trim();
    if (!shouldFoldPrompt(source)) {
        return formatTextHtml(source);
    }

    const lines = source.split(/\r?\n/);
    const firstMeaningfulIndex = lines.findIndex(line => line.trim().length > 0);
    const intro = firstMeaningfulIndex >= 0 ? lines[firstMeaningfulIndex].trim() : '';
    const rest = lines.slice(firstMeaningfulIndex + 1).join('\n').trim();
    const foldedText = rest || source;
    const lineCount = foldedText.split(/\r?\n/).filter(line => line.trim()).length;
    const charCount = foldedText.length;

    return [
        intro && rest ? `<p>${formatInlineMarkdown(intro)}</p>` : '',
        '<details class="happy-prompt-fold" open>',
        '<summary>',
        '<span class="happy-prompt-fold-icon" aria-hidden="true"></span>',
        '<span><strong>提示词已折叠</strong>',
        `<em>${lineCount} 行 · ${charCount} 字符</em></span>`,
        '</summary>',
        `<div class="happy-prompt-fold-body">${formatTextHtml(foldedText)}</div>`,
        '</details>',
    ].filter(Boolean).join('\n');
}

function shouldFoldPrompt(text: string): boolean {
    if (text.length > 1200) {
        return true;
    }
    return /(?:使用\s+\$gpt-image|生成锁|推荐续生成选项|prompt|style_id)/i.test(text) && text.length > 300;
}

function renderToolPayloadHtml(label: string, content: string): string {
    return [
        '<div class="happy-tool-payload">',
        `<div class="happy-tool-payload-label">${escapeHtml(label)}</div>`,
        `<pre><code>${escapePreHtml(content.trim())}</code></pre>`,
        '</div>',
    ].join('\n');
}

function formatTextHtml(text: string): string {
    const source = text.trim();
    if (!source) {
        return '';
    }

    const parts: string[] = [];
    const fencePattern = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = fencePattern.exec(source)) !== null) {
        if (match.index > lastIndex) {
            parts.push(formatRichTextHtml(source.slice(lastIndex, match.index)));
        }
        const language = match[1] ? ` data-language="${escapeHtml(match[1])}"` : '';
        parts.push(`<pre class="happy-message-code"${language}><code>${escapePreHtml(match[2].trim())}</code></pre>`);
        lastIndex = fencePattern.lastIndex;
    }

    if (lastIndex < source.length) {
        parts.push(formatRichTextHtml(source.slice(lastIndex)));
    }

    return parts.filter(Boolean).join('\n');
}

function formatRichTextHtml(text: string): string {
    const parts: string[] = [];
    const customBlockPattern = /<options>([\s\S]*?)<\/options>|<happy-ota-preview>([\s\S]*?)<\/happy-ota-preview>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = customBlockPattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(formatPlainTextHtml(text.slice(lastIndex, match.index)));
        }
        if (match[1] !== undefined) {
            parts.push(renderOptionsHtml(match[1]));
        } else {
            parts.push(renderOtaPreviewHtml(match[2] ?? ''));
        }
        lastIndex = customBlockPattern.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push(formatPlainTextHtml(text.slice(lastIndex)));
    }

    return parts.filter(Boolean).join('\n');
}

function renderOtaPreviewHtml(rawPreview: string): string {
    const preview = parseOtaPreviewSection(rawPreview);
    if (!preview) {
        return formatPlainTextHtml(rawPreview);
    }

    const chips = [
        preview.channel,
        preview.platform,
        preview.runtimeVersion ? `runtime ${preview.runtimeVersion}` : null,
    ].filter((item): item is string => Boolean(item));

    return [
        '<aside class="happy-ota-card" aria-label="Happy OTA preview">',
        '<div class="happy-ota-eyebrow">Preview OTA</div>',
        `<h3>${formatInlineMarkdown(preview.title)}</h3>`,
        `<p class="happy-ota-subtitle">${escapeHtml(formatOtaPreviewLabel(preview))}</p>`,
        chips.length > 0 ? `<div class="happy-ota-chips">${chips.map(chip => `<span>${escapeHtml(chip)}</span>`).join('')}</div>` : '',
        preview.summary ? `<p class="happy-ota-summary">${formatInlineMarkdown(preview.summary)}</p>` : '',
        '<details class="happy-ota-details">',
        '<summary>Details</summary>',
        '<dl class="happy-ota-fields">',
        renderOtaFieldHtml('Identity', formatOtaPreviewIdentity(preview)),
        renderOtaFieldHtml('Update ID', preview.updateId),
        renderOtaFieldHtml('Manifest', preview.manifestUrl, true),
        renderOtaFieldHtml('Source', preview.sourceUrl, true),
        '</dl>',
        '</details>',
        '</aside>',
    ].filter(Boolean).join('\n');
}

function renderOtaFieldHtml(label: string, value: string | null, link = false): string {
    const trimmed = value?.trim();
    if (!trimmed) {
        return '';
    }
    const content = link && /^https?:\/\//i.test(trimmed)
        ? `<a href="${escapeHtml(trimmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmed)}</a>`
        : escapeHtml(trimmed);
    return [
        '<div class="happy-ota-field">',
        `<dt>${escapeHtml(label)}</dt>`,
        `<dd>${content}</dd>`,
        '</div>',
    ].join('');
}

function formatPlainTextHtml(text: string): string {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const html: string[] = [];
    const paragraph: string[] = [];

    const flushParagraph = () => {
        const content = paragraph
            .map(line => line.trim())
            .filter(Boolean)
            .map(formatInlineMarkdown)
            .join('<br>');
        if (content) {
            html.push(`<p>${content}</p>`);
        }
        paragraph.length = 0;
    };

    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
            flushParagraph();
            index += 1;
            continue;
        }

        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            flushParagraph();
            html.push('<hr class="happy-inline-rule">');
            index += 1;
            continue;
        }

        const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
        if (heading) {
            flushParagraph();
            const levelClass = `happy-inline-heading-${Math.min(heading[1].length, 4)}`;
            html.push(`<h3 class="happy-inline-heading ${levelClass}">${formatInlineMarkdown(heading[2].trim())}</h3>`);
            index += 1;
            continue;
        }

        if (isMarkdownTableStart(lines, index)) {
            flushParagraph();
            const table = renderTableHtml(lines, index);
            html.push(table.html);
            index = table.nextIndex;
            continue;
        }

        if (/^\s*>\s?/.test(line)) {
            flushParagraph();
            const quoteLines: string[] = [];
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
                index += 1;
            }
            html.push(`<blockquote class="happy-blockquote">${formatPlainTextHtml(quoteLines.join('\n'))}</blockquote>`);
            continue;
        }

        const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
        if (bullet) {
            flushParagraph();
            const items: string[] = [];
            while (index < lines.length) {
                const item = /^\s*[-*]\s+(.+)$/.exec(lines[index]);
                if (!item) {
                    break;
                }
                items.push(`<li>${formatInlineMarkdown(item[1].trim())}</li>`);
                index += 1;
            }
            html.push(`<ul class="happy-list">${items.join('')}</ul>`);
            continue;
        }

        const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
        if (ordered) {
            flushParagraph();
            const items: string[] = [];
            while (index < lines.length) {
                const item = /^\s*\d+[.)]\s+(.+)$/.exec(lines[index]);
                if (!item) {
                    break;
                }
                items.push(`<li>${formatInlineMarkdown(item[1].trim())}</li>`);
                index += 1;
            }
            html.push(`<ol class="happy-list">${items.join('')}</ol>`);
            continue;
        }

        paragraph.push(line);
        index += 1;
    }

    flushParagraph();
    return html.join('\n');
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
    if (index + 1 >= lines.length) {
        return false;
    }
    return splitMarkdownTableRow(lines[index]).length > 1
        && isMarkdownTableDelimiter(lines[index + 1]);
}

function isMarkdownTableDelimiter(line: string): boolean {
    const cells = splitMarkdownTableRow(line);
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
}

function renderTableHtml(lines: string[], startIndex: number): { html: string; nextIndex: number } {
    const headers = splitMarkdownTableRow(lines[startIndex]);
    let index = startIndex + 2;
    const bodyRows: string[][] = [];

    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim() || splitMarkdownTableRow(line).length < 2) {
            break;
        }
        bodyRows.push(normalizeTableRow(splitMarkdownTableRow(line), headers.length));
        index += 1;
    }

    return {
        html: [
            '<div class="happy-table-wrap">',
            '<table class="happy-table">',
            '<thead><tr>',
            headers.map(header => `<th>${formatInlineMarkdown(header)}</th>`).join(''),
            '</tr></thead>',
            '<tbody>',
            ...bodyRows.map(row => `<tr>${row.map(cell => `<td>${formatInlineMarkdown(cell)}</td>`).join('')}</tr>`),
            '</tbody>',
            '</table>',
            '</div>',
        ].join('\n'),
        nextIndex: index,
    };
}

function splitMarkdownTableRow(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.includes('|')) {
        return [];
    }
    const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
    return withoutEdges.split('|').map(cell => cell.trim());
}

function normalizeTableRow(cells: string[], length: number): string[] {
    if (cells.length === length) {
        return cells;
    }
    if (cells.length > length) {
        return cells.slice(0, length);
    }
    return [...cells, ...Array.from({ length: length - cells.length }, () => '')];
}

function renderOptionsHtml(rawOptions: string): string {
    const options: string[] = [];
    const optionPattern = /<option>([\s\S]*?)<\/option>/gi;
    let match: RegExpExecArray | null;

    while ((match = optionPattern.exec(rawOptions)) !== null) {
        const option = oneLine(match[1]);
        if (option) {
            options.push(option);
        }
    }

    if (options.length === 0) {
        return formatPlainTextHtml(rawOptions);
    }

    if (options.length >= 3 && options.every(isGptImageStyleOption)) {
        return [
            '<div class="happy-style-options" role="group" aria-label="GPT Image style options">',
            ...options.map(option => `<div class="happy-style-option">${escapeHtml(readGptImageStyleLabel(option))}</div>`),
            '</div>',
        ].join('\n');
    }

    return [
        '<div class="happy-options" role="group" aria-label="Options">',
        '<div class="happy-options-title">Options</div>',
        '<div class="happy-options-list">',
        ...options.map(option => `<div class="happy-option">${formatInlineMarkdown(option)}</div>`),
        '</div>',
        '</div>',
    ].join('\n');
}

function isGptImageStyleOption(option: string): boolean {
    return /^\s*\[\[gpt-image-style:[^\]]+\]\]/.test(option);
}

function readGptImageStyleLabel(option: string): string {
    return option.replace(/^\s*\[\[gpt-image-style:[^\]]+\]\]\s*/, '').trim() || option;
}

function formatInlineMarkdown(text: string): string {
    return text
        .split(/(`[^`]*`)/g)
        .map(segment => {
            if (segment.length >= 2 && segment.startsWith('`') && segment.endsWith('`')) {
                return `<code>${escapeHtml(segment.slice(1, -1))}</code>`;
            }

            return escapeHtml(segment)
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        })
        .join('');
}

function buildSessionMetaHtml(session: Session): string {
    const rows: Array<{ label: string; value: string; long?: boolean }> = [];
    if (session.metadata?.flavor) rows.push({ label: 'Agent', value: session.metadata.flavor });
    if (session.metadata?.host) rows.push({ label: 'Host', value: session.metadata.host });
    rows.push({ label: 'Created', value: new Date(session.createdAt).toISOString() });
    rows.push({ label: 'Session ID', value: session.id, long: true });
    if (session.metadata?.path) rows.push({ label: 'Path', value: session.metadata.path, long: true });

    return [
        '<details class="happy-share-meta">',
        '<summary>Session details</summary>',
        '<div class="happy-meta-list" aria-label="Session metadata">',
        ...rows.map(({ label, value, long }) => [
            `<div class="happy-meta-item${long ? ' happy-meta-long' : ''}">`,
            `<span>${escapeHtml(label)}</span>`,
            `<strong>${escapeHtml(value)}</strong>`,
            '</div>',
        ].join('')),
        '</div>',
        '</details>',
    ].join('\n');
}

function buildThemeToggleHtml(): string {
    return [
        '<div class="happy-theme-control">',
        '<input class="happy-theme-checkbox" id="happy-theme-toggle" type="checkbox" aria-label="Use dark theme">',
        '<label class="happy-theme-switch" for="happy-theme-toggle">',
        '<span>Light</span>',
        '<span>Dark</span>',
        '</label>',
        '</div>',
    ].join('\n');
}

function buildShareStyleBlock(): string {
    return `<style>
body{max-width:none!important;margin:0!important;padding:0!important;background:#eef2f7!important;color:#182235!important;font:14px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif!important}
body:has(#happy-theme-toggle:checked){background:#070b14!important;color:#dbe4f0!important}
article{--article-bg:#fff;--text:#182235;--heading:#0f172a;--muted:#64748b;--border:#d8e0eb;--soft-border:#e6ebf3;--panel:#f8fafc;--panel-strong:#f1f5f9;--accent:#0284c7;--accent-text:#075985;--accent-soft:rgba(14,165,233,.1);--user-bg:#f1f5f9;--user-border:#d8e0eb;--event-bg:#faf5ff;--event-border:#e9d5ff;--code-bg:#edf4fb;--code-text:#17324d;--pre-bg:#0f172a;--pre-text:#e5edf7;max-width:720px;margin:12px auto!important;padding:18px!important;background:var(--article-bg);border:1px solid var(--border);border-radius:12px;box-shadow:0 14px 34px rgba(15,23,42,.08);color:var(--text)}
article:has(#happy-theme-toggle:checked){--article-bg:#0d0f10;--text:#d9dde3;--heading:#f5f7fa;--muted:#858b94;--border:#2b3036;--soft-border:#272c32;--panel:#14181d;--panel-strong:#111418;--accent:#58b7ff;--accent-text:#8fd0ff;--accent-soft:rgba(88,183,255,.13);--user-bg:#27292d;--user-border:#33383f;--event-bg:#211a2b;--event-border:#4b2a71;--code-bg:#1b222b;--code-text:#d7e7ff;--pre-bg:#07090c;--pre-text:#dbe4f0;box-shadow:0 28px 80px rgba(0,0,0,.38)}
article>h1{border:0!important;margin:0 0 6px!important;padding:0!important;color:var(--heading)!important;font-size:25px!important;line-height:1.2!important;font-weight:760!important;letter-spacing:0!important}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.happy-theme-control{display:flex;justify-content:flex-end;margin:-2px 0 8px}
.happy-theme-checkbox{position:absolute;opacity:0;pointer-events:none}
.happy-theme-switch{position:relative;display:grid;grid-template-columns:1fr 1fr;width:124px;padding:3px;border:1px solid var(--border);border-radius:999px;background:var(--panel-strong);cursor:pointer;user-select:none}
.happy-theme-switch:before{content:"";position:absolute;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:999px;background:var(--accent);transition:transform .18s ease}
#happy-theme-toggle:checked+.happy-theme-switch:before{transform:translateX(100%)}
.happy-theme-switch span{position:relative;z-index:1;text-align:center;color:var(--muted);font-size:11px;font-weight:760;line-height:22px}
#happy-theme-toggle:not(:checked)+.happy-theme-switch span:first-child,#happy-theme-toggle:checked+.happy-theme-switch span:last-child{color:#fff}
.happy-share-intro{margin:-2px 0 7px;padding:0;background:transparent;border:0;color:var(--muted);font-size:11px}
.happy-share-intro p{margin:0!important}
.happy-share-meta{margin:0 0 8px}
.happy-share-meta summary{width:max-content;max-width:100%;cursor:pointer;list-style:none;color:var(--muted);font-size:11px;font-weight:700}
.happy-share-meta summary::-webkit-details-marker{display:none}
.happy-share-meta summary:before{content:"+";display:inline-grid;place-items:center;width:14px;height:14px;margin-right:5px;border:1px solid var(--soft-border);border-radius:999px;color:var(--accent);font-size:10px;line-height:1}
.happy-share-meta[open] summary:before{content:"-"}
.happy-meta-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.happy-meta-item{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%;padding:4px 8px;border:1px solid var(--soft-border);border-radius:999px;background:var(--panel)}
.happy-meta-long{max-width:min(100%,390px)}
.happy-meta-item span{flex:0 0 auto;color:var(--muted);font-size:9px;font-weight:780;text-transform:uppercase;letter-spacing:.08em}
.happy-meta-item strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);font-size:12px;font-weight:650;line-height:1.3}
.happy-share-rule{height:1px;border:0!important;background:var(--soft-border);margin:10px 0!important}
.happy-turn{margin:12px 0;padding:0}
.happy-turn-meta{display:flex;align-items:baseline;gap:8px;margin:0 0 4px}
.happy-turn-meta span{font-size:11px;font-weight:780;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
.happy-turn-user .happy-turn-meta span{color:#059669}
article:has(#happy-theme-toggle:checked) .happy-turn-user .happy-turn-meta span{color:#34d399}
.happy-turn-event .happy-turn-meta span{color:#7c3aed}
article:has(#happy-theme-toggle:checked) .happy-turn-event .happy-turn-meta span{color:#c084fc}
.happy-turn-meta time{color:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
.happy-turn-body{padding:7px 9px;border:1px solid var(--soft-border);border-radius:9px;background:var(--panel);color:var(--text)}
.happy-turn-assistant{margin:16px 0}
.happy-turn-assistant .happy-turn-body{padding:0 2px;border:0;border-radius:0;background:transparent;color:var(--text)}
.happy-turn-user{display:flex;flex-direction:column}
.happy-turn-user .happy-turn-meta{justify-content:flex-end}
.happy-turn-user .happy-turn-body{background:var(--user-bg);border-color:var(--user-border)}
.happy-turn-user .happy-turn-body{width:fit-content;max-width:min(86%,680px);margin-left:auto;padding:9px 12px;border-radius:13px}
.happy-turn-event .happy-turn-body{background:var(--event-bg);border-color:var(--event-border)}
.happy-turn-body p{margin:0 0 6px!important}
.happy-turn-body p:last-child{margin-bottom:0!important}
.happy-turn-body code{padding:1px 4px;border:1px solid var(--soft-border);border-radius:5px;background:var(--code-bg);color:var(--code-text);font:84%/1.45 ui-monospace,SFMono-Regular,SFMono,Menlo,Consolas,monospace}
.happy-inline-heading{margin:8px 0 5px!important;color:var(--heading);font-size:16px!important;line-height:1.28!important;font-weight:760!important}
.happy-inline-heading:first-child{margin-top:0!important}
.happy-inline-heading-1,.happy-inline-heading-2{font-size:17px!important}
.happy-list{margin:4px 0 6px!important;padding-left:1.15rem!important}
.happy-list li{margin:2px 0;padding-left:1px}
.happy-inline-rule{height:1px;border:0!important;background:var(--soft-border);margin:16px 0!important}
.happy-blockquote{margin:10px 0;padding:8px 10px;border-left:3px solid var(--accent);border-radius:0 8px 8px 0;background:var(--accent-soft);color:var(--text)}
.happy-blockquote p{margin-bottom:5px!important}
.happy-table-wrap{margin:9px 0 12px;overflow-x:auto;border:1px solid var(--soft-border);border-radius:10px;background:var(--panel)}
.happy-table{width:100%;min-width:520px;border-collapse:collapse;font-size:12px;line-height:1.45}
.happy-table th,.happy-table td{padding:8px 9px;border:1px solid var(--soft-border);vertical-align:top;text-align:left}
.happy-table th{background:var(--panel-strong);color:var(--heading);font-weight:720}
.happy-table td{color:var(--text)}
.happy-options{margin:7px 0;padding:6px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:9px;background:var(--accent-soft)}
.happy-options-title{margin:0 0 5px;color:var(--accent-text);font-size:10px;font-weight:780;text-transform:uppercase;letter-spacing:.08em}
.happy-options-list{display:grid;gap:5px}
.happy-option{position:relative;padding:6px 8px 6px 24px;border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);border-radius:7px;background:var(--article-bg);color:var(--text);font-weight:620;line-height:1.34}
.happy-option:before{content:"";position:absolute;left:10px;top:1em;width:7px;height:7px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
.happy-style-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:8px 0 10px}
.happy-style-option{display:flex;align-items:center;min-height:48px;padding:8px 10px;border:1px solid #e3d7c7;border-radius:9px;background:#eaf1f7;color:#1f2d3d;font-size:14px;font-weight:760;line-height:1.22}
.happy-prompt-fold{margin:7px 0;border:1px solid var(--soft-border);border-radius:10px;overflow:hidden;background:var(--panel-strong)}
.happy-prompt-fold summary{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:center;gap:8px;padding:8px 10px;cursor:pointer;list-style:none}
.happy-prompt-fold summary::-webkit-details-marker{display:none}
.happy-prompt-fold-icon{width:19px;height:22px;border:2px solid var(--muted);border-radius:4px;position:relative;opacity:.82}
.happy-prompt-fold-icon:after{content:"";position:absolute;right:-2px;top:-2px;border-left:7px solid transparent;border-bottom:7px solid var(--muted)}
.happy-prompt-fold strong{display:block;color:var(--heading);font-size:15px;line-height:1.15}
.happy-prompt-fold em{display:block;margin-top:2px;color:var(--muted);font-style:normal;font-size:11px}
.happy-prompt-fold-body{padding:9px 10px 11px;border-top:1px solid var(--soft-border);color:var(--muted);font-size:12px;line-height:1.5}
.happy-ota-card{margin:8px 0 10px;padding:12px;border:1px solid var(--soft-border);border-radius:11px;background:linear-gradient(180deg,var(--panel),var(--panel-strong));box-shadow:0 10px 22px rgba(15,23,42,.06)}
.happy-ota-eyebrow{margin:0 0 5px;color:var(--muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.12em}
.happy-ota-card h3{margin:0 0 4px!important;color:var(--heading)!important;font-size:17px!important;line-height:1.24!important;font-weight:760!important;overflow-wrap:anywhere}
.happy-ota-subtitle{margin:0 0 7px!important;color:var(--muted);font-size:12px}
.happy-ota-chips{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 8px}
.happy-ota-chips span{padding:2px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);font-size:10px;font-weight:700}
.happy-ota-summary{margin:0 0 8px!important;padding:8px 9px;border-radius:9px;background:var(--article-bg);color:var(--text);font-size:12px}
.happy-ota-details{margin:0;border:1px solid var(--soft-border);border-radius:9px;background:var(--article-bg);overflow:hidden}
.happy-ota-details summary{padding:7px 9px;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;cursor:pointer}
.happy-ota-fields{display:grid;margin:0;border-top:1px solid var(--soft-border);background:var(--article-bg)}
.happy-ota-field{display:grid;grid-template-columns:104px minmax(0,1fr);gap:10px;padding:8px 10px;border-bottom:1px solid var(--soft-border)}
.happy-ota-field:last-child{border-bottom:0}
.happy-ota-field dt{margin:0;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
.happy-ota-field dd{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--text);font:12px/1.45 ui-monospace,SFMono-Regular,SFMono,Menlo,Consolas,monospace}
.happy-image-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;margin:8px 0 10px}
.happy-image-gallery:has(.happy-image-card:only-child){grid-template-columns:1fr}
.happy-image-card{position:relative;min-height:112px;max-height:360px;margin:0!important;overflow:hidden;border:1px solid var(--soft-border);border-radius:10px;background:var(--panel-strong)}
.happy-image-card img{display:block;width:100%;height:100%;object-fit:cover}
.happy-image-gallery:has(.happy-image-card:only-child) .happy-image-card img{object-fit:contain;background:var(--article-bg)}
.happy-image-placeholder{display:grid;place-items:center;width:100%;height:100%;min-height:112px;background:linear-gradient(135deg,var(--panel),var(--panel-strong));color:var(--muted);font-size:11px;font-weight:760;text-transform:uppercase;letter-spacing:.08em}
.happy-image-card figcaption{position:absolute;left:0;right:0;bottom:0;display:grid;gap:1px;padding:24px 7px 6px;background:linear-gradient(to top,rgba(2,6,23,.72),rgba(2,6,23,0));color:#fff}
.happy-image-card figcaption strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.2}
.happy-image-card figcaption span{font-size:9px;opacity:.78;line-height:1.2}
.happy-message-code,.happy-tool-payload pre{margin:6px 0 0!important;padding:8px!important;border:1px solid var(--soft-border);border-radius:8px;background:var(--pre-bg)!important;color:var(--pre-text)!important;overflow:auto;max-height:420px;font-size:11px!important;line-height:1.45!important}
.happy-message-code code,.happy-tool-payload pre code{background:transparent!important;color:inherit!important;padding:0!important;font-size:inherit!important}
.happy-tool-group{margin:7px 0;border:1px solid var(--soft-border);border-radius:9px;background:var(--panel-strong)}
.happy-tool-group summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;list-style:none;padding:7px 9px;color:var(--text);font-size:12px;font-weight:680}
.happy-tool-group summary::-webkit-details-marker{display:none}
.happy-tool-group summary strong{color:var(--muted);font-size:10px;font-weight:650}
.happy-tool-group[open] summary{border-bottom:1px solid var(--soft-border)}
.happy-tool-list{padding:8px}
.happy-tool{margin:0 0 8px;padding:8px;border:1px solid var(--soft-border);border-radius:8px;background:var(--panel)}
.happy-tool:last-child{margin-bottom:0}
.happy-tool-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:5px}
.happy-tool-name{font-weight:720;color:var(--heading)}
.happy-tool-state{padding:1px 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent-text);font-size:10px;font-weight:680}
.happy-tool-head time{margin-left:auto;color:var(--muted);font-size:10px}
.happy-tool-description,.happy-tool-permission{margin:4px 0!important;color:var(--muted);font-size:11px}
.happy-tool-payload{margin-top:6px}
.happy-tool-payload-label{color:var(--muted);font-size:10px;font-weight:760;text-transform:uppercase;letter-spacing:.06em}
.happy-tool-child{margin-top:7px;padding-top:7px;border-top:1px dashed var(--soft-border)}
	@media(max-width:720px){body{font-size:13px!important;line-height:1.48!important}article{margin:0!important;padding:10px 8px!important;border:0;border-radius:0;min-height:100vh}article>h1{font-size:20px!important;margin-bottom:5px!important}.happy-theme-control{margin:-1px 0 6px}.happy-theme-switch{width:116px}.happy-share-intro{margin-bottom:6px;font-size:11px}.happy-meta-item{padding:3px 7px}.happy-meta-long{max-width:100%}.happy-meta-item span{font-size:8px}.happy-meta-item strong{font-size:11px}.happy-turn{margin:7px 0}.happy-turn-assistant{margin:11px 0}.happy-turn-body{padding:7px 9px;border-radius:8px}.happy-turn-user .happy-turn-body{max-width:86%;padding:8px 11px}.happy-turn-meta{margin-bottom:2px}.happy-style-options{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.happy-style-option{min-height:44px;padding:7px 8px;font-size:13px}.happy-prompt-fold strong{font-size:14px}.happy-prompt-fold-body{font-size:11px}.happy-ota-card{padding:10px;border-radius:10px}.happy-ota-card h3{font-size:15px!important}.happy-ota-subtitle{font-size:11px}.happy-ota-summary{font-size:12px}.happy-ota-field{grid-template-columns:74px minmax(0,1fr);gap:7px;padding:7px 8px}.happy-image-gallery{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:7px 0}.happy-image-gallery:has(.happy-image-card:only-child){grid-template-columns:1fr}.happy-image-card{min-height:104px;max-height:320px;border-radius:9px}.happy-image-placeholder{min-height:104px}.happy-table{min-width:500px;font-size:11px}.happy-table th,.happy-table td{padding:7px 8px}.happy-tool-group summary{align-items:flex-start;flex-direction:column;gap:2px}.happy-tool-head time{width:100%;margin-left:0}.happy-message-code,.happy-tool-payload pre{font-size:10px!important}}
</style>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapePreHtml(value: string): string {
    return escapeHtml(value).replace(/\r?\n/g, '&#10;');
}
