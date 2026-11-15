import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PublicSessionBlock, PublicSessionSnapshot } from '@slopus/happy-wire';
import type { ResolvedAttachment, TranscriptCandidate } from './adapters/types';
import { readResolvedAttachmentBytes } from './adapters/shared';
import { assertShareExportSafe } from './security/exportPolicy';
import { prepareSessionSnapshot } from './sessionSnapshot';

export type ExportSessionHtmlOptions = {
    candidate: TranscriptCandidate;
    outputPath: string;
    allowSensitive?: boolean;
    overwrite?: boolean;
};

export type ExportSessionHtmlResult = {
    outputPath: string;
    source: TranscriptCandidate['provider'];
    title: string;
    messageCount: number;
    attachmentCount: number;
    attachmentBytes: number;
    bytes: number;
};

type EmbeddedAttachment = ResolvedAttachment & { dataUrl: string };

const SOURCE_LABELS = {
    codex: 'Codex',
    'claude-code': 'Claude Code',
    paws: 'Paws',
} as const;

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function safeLink(value: string): string | null {
    try {
        const url = new URL(value);
        return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : null;
    } catch {
        return null;
    }
}

function renderInline(markdown: string): string {
    const tokens: string[] = [];
    const preserve = (html: string) => {
        const marker = String.fromCodePoint(0xe000) + tokens.length + String.fromCodePoint(0xe001);
        tokens.push(html);
        return marker;
    };
    let text = markdown.replace(/\x60([^\x60\n]+)\x60/g, (_match, code: string) =>
        preserve('<code>' + escapeHtml(code) + '</code>'));
    text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, target: string) => {
        const href = safeLink(target);
        if (!href) return match;
        return preserve(
            '<a href="' + escapeHtml(href) + '" target="_blank" rel="noreferrer noopener">'
            + escapeHtml(label) + '</a>',
        );
    });
    text = escapeHtml(text)
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    tokens.forEach((token, index) => {
        const marker = String.fromCodePoint(0xe000) + index + String.fromCodePoint(0xe001);
        text = text.replaceAll(marker, token);
    });
    return text;
}

function tableCells(line: string): string[] {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
    const cells = tableCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdown(markdown: string): string {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const output: string[] = [];
    let index = 0;
    const special = (line: string, next?: string) =>
        !line.trim()
        || /^\x60{3}/.test(line)
        || /^#{1,4}\s+/.test(line)
        || /^>\s?/.test(line)
        || /^[-*+]\s+/.test(line)
        || /^\d+\.\s+/.test(line)
        || /^(-{3,}|\*{3,})\s*$/.test(line)
        || (line.includes('|') && Boolean(next) && isTableDivider(next!));

    while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) {
            index += 1;
            continue;
        }
        if (line.startsWith('\x60\x60\x60')) {
            const language = line.slice(3).trim().replace(/[^A-Za-z0-9_+-]/g, '').slice(0, 32);
            const code: string[] = [];
            index += 1;
            while (index < lines.length && !lines[index].startsWith('\x60\x60\x60')) {
                code.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;
            output.push(
                '<figure class="code-block">'
                + '<figcaption><span>' + escapeHtml(language || 'code') + '</span>'
                + '<button type="button" class="copy-code">Copy</button></figcaption>'
                + '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre></figure>',
            );
            continue;
        }
        const heading = /^(#{1,4})\s+(.+)$/.exec(line);
        if (heading) {
            const level = Math.min(heading[1].length + 1, 5);
            output.push('<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>');
            index += 1;
            continue;
        }
        if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
            output.push('<hr>');
            index += 1;
            continue;
        }
        if (line.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
            const headers = tableCells(line);
            const rows: string[][] = [];
            index += 2;
            while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                rows.push(tableCells(lines[index]));
                index += 1;
            }
            output.push(
                '<div class="table-wrap"><table><thead><tr>'
                + headers.map((cell) => '<th>' + renderInline(cell) + '</th>').join('')
                + '</tr></thead><tbody>'
                + rows.map((row) => '<tr>' + row.map((cell) => '<td>' + renderInline(cell) + '</td>').join('') + '</tr>').join('')
                + '</tbody></table></div>',
            );
            continue;
        }
        if (/^>\s?/.test(line)) {
            const quote: string[] = [];
            while (index < lines.length && /^>\s?/.test(lines[index])) {
                quote.push(lines[index].replace(/^>\s?/, ''));
                index += 1;
            }
            output.push('<blockquote>' + quote.map(renderInline).join('<br>') + '</blockquote>');
            continue;
        }
        const unordered = /^[-*+]\s+/.test(line);
        const ordered = /^\d+\.\s+/.test(line);
        if (unordered || ordered) {
            const tag = ordered ? 'ol' : 'ul';
            const pattern = ordered ? /^\d+\.\s+/ : /^[-*+]\s+/;
            const items: string[] = [];
            while (index < lines.length && pattern.test(lines[index])) {
                items.push('<li>' + renderInline(lines[index].replace(pattern, '')) + '</li>');
                index += 1;
            }
            output.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
            continue;
        }
        const paragraph: string[] = [];
        while (index < lines.length && !special(lines[index], lines[index + 1])) {
            paragraph.push(lines[index]);
            index += 1;
        }
        if (paragraph.length === 0) {
            paragraph.push(line);
            index += 1;
        }
        output.push('<p>' + paragraph.map(renderInline).join('<br>') + '</p>');
    }
    return output.join('');
}

function readableBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderAttachment(block: Extract<PublicSessionBlock, { type: 'attachment' }>, attachment?: EmbeddedAttachment): string {
    const name = escapeHtml(block.name);
    if (!attachment) {
        return '<div class="attachment attachment--missing">Attachment unavailable: ' + name + '</div>';
    }
    const details = '<span class="attachment__name">' + name + '</span>'
        + '<span class="attachment__meta">' + readableBytes(block.size) + '</span>';
    if (block.kind === 'image') {
        return '<figure class="attachment attachment--image"><img loading="lazy" src="' + attachment.dataUrl
            + '" alt="' + name + '"><figcaption>' + details + '</figcaption></figure>';
    }
    if (block.kind === 'audio') {
        return '<div class="attachment">' + details + '<audio controls preload="metadata" src="'
            + attachment.dataUrl + '"></audio></div>';
    }
    if (block.kind === 'video') {
        return '<div class="attachment">' + details + '<video controls preload="metadata" src="'
            + attachment.dataUrl + '"></video></div>';
    }
    return '<a class="attachment attachment--file" download="' + name + '" href="' + attachment.dataUrl
        + '">' + details + '<span aria-hidden="true">Download</span></a>';
}

function renderBlock(block: PublicSessionBlock, attachments: Map<string, EmbeddedAttachment>): string {
    if (block.type === 'text') return '<div class="markdown">' + renderMarkdown(block.markdown) + '</div>';
    if (block.type === 'thinking') {
        return '<details class="thinking"><summary><span>Thinking</span><span aria-hidden="true">⌄</span></summary>'
            + '<div class="thinking__body markdown">' + renderMarkdown(block.markdown) + '</div></details>';
    }
    if (block.type === 'tool') {
        const state = escapeHtml(block.status);
        return '<details class="tool"><summary><span class="tool__state tool__state--' + state + '"></span>'
            + '<span class="tool__name">' + escapeHtml(block.title || block.name) + '</span>'
            + '<span class="tool__status">' + state + '</span><span aria-hidden="true">⌄</span></summary>'
            + (block.body ? '<pre class="tool__body">' + escapeHtml(block.body) + '</pre>' : '')
            + '</details>';
    }
    return renderAttachment(block, attachments.get(block.attachmentId));
}

function renderMessage(
    message: PublicSessionSnapshot['messages'][number],
    attachments: Map<string, EmbeddedAttachment>,
): string {
    const roleLabel = message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : 'System';
    const time = new Date(message.createdAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
    return '<article class="message message--' + escapeHtml(message.role) + '" data-message-id="' + escapeHtml(message.id) + '">'
        + '<div class="message__meta"><span>' + roleLabel + '</span><time datetime="'
        + escapeHtml(new Date(message.createdAt).toISOString()) + '">' + escapeHtml(time) + '</time></div>'
        + '<div class="message__body">'
        + message.blocks.map((block) => renderBlock(block, attachments)).join('')
        + '</div></article>';
}

const STYLES = [
    ':root{color-scheme:light dark;--bg:#f7f7f3;--surface:#fff;--surface-2:#f0f2ec;--border:#dfe3da;--text:#1f2a22;--text-2:#667068;--accent:#719d73;--accent-soft:#e3eee1;--user:#dfeadd;--code:#18211b;--code-text:#e7efe8;--danger:#b14b45;--shadow:0 18px 50px rgba(30,45,32,.08);--fs-xs:12px;--fs-sm:14px;--fs-base:16px;--fs-lg:20px;--fs-xl:25px;--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-6:24px;--sp-8:32px;--r-sm:8px;--r-md:12px;--r-lg:18px;--r-pill:999px}',
    '*{box-sizing:border-box}',
    'html{background:var(--bg);scroll-behavior:smooth}',
    'body{margin:0;color:var(--text);background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;font-size:var(--fs-base);line-height:1.65;-webkit-font-smoothing:antialiased}',
    'button,input{font:inherit}',
    'a{color:var(--accent);text-underline-offset:3px}',
    '.topbar{position:sticky;top:0;z-index:5;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(18px)}',
    '.topbar__inner{max-width:840px;margin:0 auto;padding:var(--sp-3) var(--sp-6);display:flex;align-items:center;gap:var(--sp-3)}',
    '.mark{display:grid;place-items:center;width:34px;height:34px;border-radius:var(--r-md);background:var(--accent);color:#fff;box-shadow:var(--shadow)}.mark svg{width:20px;height:20px;fill:currentColor}',
    '.heading{min-width:0;flex:1}',
    'h1{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--fs-base);line-height:1.35;font-weight:700;letter-spacing:-.01em}',
    '.subtitle{display:flex;gap:var(--sp-2);color:var(--text-2);font-size:var(--fs-xs);font-variant-numeric:tabular-nums}',
    '.source{color:var(--accent);font-weight:700}',
    '.controls{max-width:840px;margin:0 auto;padding:var(--sp-3) var(--sp-6);display:flex;gap:var(--sp-2)}',
    '.search{min-width:0;flex:1;border:1px solid var(--border);border-radius:var(--r-pill);padding:9px 14px;color:var(--text);background:var(--surface);outline:none}',
    '.search:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}',
    '.control{border:1px solid var(--border);border-radius:var(--r-pill);padding:8px 13px;color:var(--text);background:var(--surface);cursor:pointer}',
    '.control:hover,.control:focus-visible{background:var(--accent-soft);outline:none}',
    'main{max-width:800px;margin:0 auto;padding:var(--sp-6) var(--sp-6) 64px}',
    '.message{margin:0 0 var(--sp-8)}',
    '.message__meta{display:flex;align-items:center;gap:var(--sp-2);margin:0 0 var(--sp-2);color:var(--text-2);font-size:var(--fs-xs)}',
    '.message__meta span{color:var(--text);font-weight:700}',
    '.message__body{min-width:0}',
    '.message--user{margin-left:auto;max-width:84%}',
    '.message--user .message__meta{justify-content:flex-end}',
    '.message--user .message__body{padding:var(--sp-4) var(--sp-6);border-radius:var(--r-lg) var(--r-lg) var(--r-sm) var(--r-lg);background:var(--user)}',
    '.message--system .message__body{padding:var(--sp-3) var(--sp-4);border-left:3px solid var(--border);color:var(--text-2)}',
    '.markdown>:first-child{margin-top:0}.markdown>:last-child{margin-bottom:0}',
    '.markdown p,.markdown ul,.markdown ol,.markdown blockquote,.markdown .table-wrap{margin:0 0 var(--sp-4)}',
    '.markdown h2,.markdown h3,.markdown h4,.markdown h5{margin:var(--sp-6) 0 var(--sp-3);line-height:1.3;letter-spacing:-.01em}',
    '.markdown h2{font-size:var(--fs-xl)}.markdown h3{font-size:var(--fs-lg)}.markdown h4,.markdown h5{font-size:var(--fs-base)}',
    '.markdown ul,.markdown ol{padding-left:24px}.markdown li+li{margin-top:var(--sp-1)}',
    '.markdown blockquote{margin-left:0;padding:var(--sp-2) var(--sp-4);border-left:3px solid var(--accent);color:var(--text-2);background:var(--surface-2);border-radius:0 var(--r-sm) var(--r-sm) 0}',
    '.markdown code{padding:2px 5px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em}',
    '.code-block{margin:var(--sp-4) 0;border-radius:var(--r-md);overflow:hidden;background:var(--code);color:var(--code-text);box-shadow:var(--shadow)}',
    '.code-block figcaption{display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-bottom:1px solid rgba(255,255,255,.12);color:#aebcaf;font:var(--fs-xs)/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.copy-code{border:0;color:inherit;background:transparent;cursor:pointer}.copy-code:hover,.copy-code:focus-visible{color:#fff;outline:none}',
    '.code-block pre,.tool__body{margin:0;padding:var(--sp-4);overflow:auto;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}',
    '.table-wrap{overflow:auto;border:1px solid var(--border);border-radius:var(--r-md)}',
    'table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}th,td{padding:9px 12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}th{background:var(--surface-2);font-weight:700}tr:last-child td{border-bottom:0}',
    'details{margin:var(--sp-3) 0;border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface);overflow:hidden}',
    'summary{display:flex;align-items:center;gap:var(--sp-2);padding:10px 12px;cursor:pointer;list-style:none;color:var(--text-2);font-size:var(--fs-sm)}summary::-webkit-details-marker{display:none}summary>:last-child{margin-left:auto}',
    'details[open]>summary{border-bottom:1px solid var(--border)}',
    '.thinking__body{padding:var(--sp-4);color:var(--text-2);background:var(--surface-2)}',
    '.tool__state{width:8px;height:8px;border-radius:50%;background:var(--text-2)}.tool__state--completed{background:var(--accent)}.tool__state--failed{background:var(--danger)}',
    '.tool__name{color:var(--text);font-weight:600}.tool__status{font-size:var(--fs-xs)}.tool__body{color:var(--text-2);background:var(--surface-2)}',
    '.attachment{display:flex;align-items:center;gap:var(--sp-3);margin:var(--sp-3) 0;padding:var(--sp-3);border:1px solid var(--border);border-radius:var(--r-md);background:var(--surface);text-decoration:none;color:var(--text)}',
    '.attachment--image{display:block;padding:0;overflow:hidden}.attachment--image img{display:block;width:100%;max-height:640px;object-fit:contain;background:var(--surface-2)}.attachment--image figcaption{display:flex;gap:var(--sp-2);padding:var(--sp-2) var(--sp-3)}',
    '.attachment audio,.attachment video{width:100%}.attachment video{max-height:640px}.attachment__name{min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:600}.attachment__meta{margin-left:auto;color:var(--text-2);font-size:var(--fs-xs)}',
    '.attachment--missing{color:var(--danger)}',
    '.empty{display:none;padding:48px 0;text-align:center;color:var(--text-2)}',
    '.footer{max-width:800px;margin:0 auto;padding:0 var(--sp-6) var(--sp-8);color:var(--text-2);font-size:var(--fs-xs);text-align:center}',
    '@media(max-width:640px){.topbar__inner,.controls,main,.footer{padding-left:var(--sp-4);padding-right:var(--sp-4)}.controls{flex-wrap:wrap}.search{flex-basis:100%}.message--user{max-width:92%}}',
    '@media(prefers-color-scheme:dark){:root{--bg:#111713;--surface:#18201a;--surface-2:#202a22;--border:#334138;--text:#edf3ed;--text-2:#a8b4aa;--accent:#8eb992;--accent-soft:#26382a;--user:#29402d;--code:#090d0a;--shadow:0 18px 50px rgba(0,0,0,.28)}}',
    '@media print{.topbar{position:static}.controls,.copy-code{display:none}body{background:#fff;color:#111}main{max-width:none}.message{break-inside:avoid}details:not([open])>*:not(summary){display:block}}',
].join('\n');

const SCRIPT = [
    "const search=document.getElementById('transcript-search');",
    "const messages=[...document.querySelectorAll('.message')];",
    "const empty=document.getElementById('empty-state');",
    "search.addEventListener('input',()=>{const query=search.value.trim().toLocaleLowerCase();let visible=0;messages.forEach((message)=>{const show=!query||message.textContent.toLocaleLowerCase().includes(query);message.hidden=!show;if(show)visible+=1});empty.style.display=visible?'none':'block'});",
    "const toggle=document.getElementById('toggle-details');",
    "toggle.addEventListener('click',()=>{const details=[...document.querySelectorAll('details')];const shouldOpen=details.some((item)=>!item.open);details.forEach((item)=>{item.open=shouldOpen});toggle.textContent=shouldOpen?'Collapse details':'Expand details'});",
    "document.querySelectorAll('.copy-code').forEach((button)=>button.addEventListener('click',async()=>{const code=button.closest('.code-block').querySelector('code').textContent;try{await navigator.clipboard.writeText(code);button.textContent='Copied'}catch{button.textContent='Copy failed'}setTimeout(()=>{button.textContent='Copy'},1200)}));",
].join('\n');

export function renderSessionHtml(
    snapshot: PublicSessionSnapshot,
    attachments: EmbeddedAttachment[],
): string {
    const source = snapshot.source?.provider ? SOURCE_LABELS[snapshot.source.provider] : 'Coding agent';
    const sharedAt = new Date(snapshot.sharedAt);
    const attachmentMap = new Map(attachments.map((attachment) => [attachment.attachmentId, attachment]));
    const transcript = [...snapshot.messages].reverse().map((message) => renderMessage(message, attachmentMap)).join('\n');
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="referrer" content="no-referrer">',
        '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; media-src data:; style-src &#39;unsafe-inline&#39;; script-src &#39;unsafe-inline&#39;; object-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">',
        '<title>' + escapeHtml(snapshot.title) + '</title>',
        '<style>' + STYLES + '</style>',
        '</head>',
        '<body>',
        '<header class="topbar"><div class="topbar__inner"><div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="6.1" cy="7" r="2.2"/><circle cx="11" cy="4.8" r="2.2"/><circle cx="16" cy="6" r="2.2"/><circle cx="18.7" cy="10.5" r="2"/><path d="M12 9.2c-3.7 0-6.8 3.4-6.8 6.2 0 2.3 1.8 3.8 4 3.8 1.1 0 1.8-.5 2.8-.5s1.7.5 2.8.5c2.2 0 4-1.5 4-3.8 0-2.8-3.1-6.2-6.8-6.2Z"/></svg></div>',
        '<div class="heading"><h1>' + escapeHtml(snapshot.title) + '</h1><div class="subtitle"><span class="source">'
            + source + '</span><time datetime="' + escapeHtml(sharedAt.toISOString()) + '">'
            + escapeHtml(sharedAt.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })) + '</time></div></div></div>',
        '<div class="controls"><input class="search" id="transcript-search" type="search" placeholder="Search this conversation" aria-label="Search this conversation">',
        '<button class="control" id="toggle-details" type="button">Expand details</button></div></header>',
        '<main id="transcript" aria-label="Conversation transcript">' + transcript
            + '<div class="empty" id="empty-state">No matching messages</div></main>',
        '<footer class="footer">Local Paws snapshot · Read-only · No network required</footer>',
        '<script>' + SCRIPT + '</script>',
        '</body>',
        '</html>',
    ].join('\n');
}

export async function exportSessionHtml(options: ExportSessionHtmlOptions): Promise<ExportSessionHtmlResult> {
    const prepared = await prepareSessionSnapshot(options.candidate);
    assertShareExportSafe({
        findings: prepared.findings,
        unresolvedAttachments: prepared.converted.unresolvedAttachments,
    }, { allowSensitive: options.allowSensitive });
    const attachments = await Promise.all(prepared.converted.attachments.map(async (attachment) => ({
        ...attachment,
        dataUrl: 'data:' + attachment.mimeType + ';base64,'
            + (await readResolvedAttachmentBytes(attachment)).toString('base64'),
    })));
    const html = renderSessionHtml(prepared.converted.snapshot, attachments);
    const outputPath = resolve(options.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    try {
        await writeFile(outputPath, html, {
            encoding: 'utf8',
            flag: options.overwrite ? 'w' : 'wx',
            mode: 0o600,
        });
        await chmod(outputPath, 0o600);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error('Output file already exists; use --force to replace it');
        }
        throw error;
    }
    return {
        outputPath,
        source: prepared.inspection.source,
        title: prepared.inspection.title,
        messageCount: prepared.inspection.messageCount,
        attachmentCount: prepared.inspection.attachmentCount,
        attachmentBytes: prepared.inspection.attachmentBytes,
        bytes: Buffer.byteLength(html),
    };
}
