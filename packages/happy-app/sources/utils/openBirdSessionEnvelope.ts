import type { Session } from '@/sync/storageTypes';
import type { Message, ToolCallMessage } from '@/sync/typesMessage';
import type { AgentEvent } from '@/sync/typesRaw';

/**
 * 会话 → OpenBird 分享「信封」序列化器。
 *
 * 唯一事实源是 openbird--session-theme/docs/session-share-contract.md。信封结构：
 *   { temp, theme, meta, turns[] }
 * 每个 turn：{ role, author, markdown, tools[], options[] }
 *   - tools[]   收敛工具活动为 { title, steps[] }（渲染在正文之前的折叠块）
 *   - markdown  该轮消息正文（干净 Markdown，图片以 ![alt](url) 内联）
 *   - options[] Happy 选项块，{ label, selected }（渲染在正文之后）
 *
 * 图片由调用方先上传拿到公网 URL（openBirdShareAssets），这里通过 attachmentUrls
 * 映射把 ![alt](url) 内联进对应 turn 的 markdown。
 */

export type OpenBirdTheme = 'document' | 'chat';

export interface OpenBirdEnvelopeMeta {
    title: string;
    model: string | null;
    source: 'Happy';
    date: string;
    turnCount: number;
}

export interface OpenBirdEnvelopeTool {
    title: string;
    steps: string[];
}

export interface OpenBirdEnvelopeOption {
    label: string;
    selected: boolean;
}

export interface OpenBirdEnvelopeTurn {
    role: 'user' | 'assistant';
    author: string | null;
    markdown: string;
    tools: OpenBirdEnvelopeTool[];
    options: OpenBirdEnvelopeOption[];
}

export interface OpenBirdSessionEnvelope {
    temp: true;
    theme: OpenBirdTheme;
    meta: OpenBirdEnvelopeMeta;
    turns: OpenBirdEnvelopeTurn[];
}

export interface BuildOpenBirdEnvelopeOptions {
    theme?: OpenBirdTheme;
    sharedAt?: number;
    /** ref → 公网图片 URL（由 openBirdShareAssets.prepareOpenBirdAttachmentUrls 产出）。 */
    attachmentUrls?: Record<string, string>;
}

export function buildOpenBirdSessionEnvelope(
    session: Session,
    messages: Message[],
    options: BuildOpenBirdEnvelopeOptions = {},
): OpenBirdSessionEnvelope {
    const sharedAt = options.sharedAt ?? Date.now();
    const attachmentUrls = options.attachmentUrls ?? {};
    const sorted = sortMessagesForShare(messages);

    const turns: OpenBirdEnvelopeTurn[] = [];
    // 当前累积的助手侧内容（工具活动 + 正文 + 选项），在遇到用户消息或结束时收口。
    let pendingAssistant: {
        tools: OpenBirdEnvelopeTool[];
        markdownParts: string[];
        options: OpenBirdEnvelopeOption[];
        author: string | null;
    } | null = null;

    const flushAssistant = () => {
        if (!pendingAssistant) {
            return;
        }
        const markdown = joinMarkdown(pendingAssistant.markdownParts);
        const hasContent = markdown.length > 0
            || pendingAssistant.tools.length > 0
            || pendingAssistant.options.length > 0;
        if (hasContent) {
            turns.push({
                role: 'assistant',
                author: pendingAssistant.author,
                markdown,
                tools: pendingAssistant.tools,
                options: pendingAssistant.options,
            });
        }
        pendingAssistant = null;
    };

    const ensureAssistant = () => {
        if (!pendingAssistant) {
            pendingAssistant = { tools: [], markdownParts: [], options: [], author: null };
        }
        return pendingAssistant;
    };

    for (const message of sorted) {
        switch (message.kind) {
            case 'user-text': {
                flushAssistant();
                const text = (message.displayText ?? message.text).trim();
                if (text.length === 0) {
                    break;
                }
                turns.push({
                    role: 'user',
                    author: null,
                    markdown: inlineAttachments(text, attachmentUrls),
                    tools: [],
                    options: [],
                });
                break;
            }
            case 'agent-text': {
                if (message.isThinking) {
                    break;
                }
                const text = message.text.trim();
                if (text.length === 0) {
                    break;
                }
                ensureAssistant().markdownParts.push(inlineAttachments(text, attachmentUrls));
                break;
            }
            case 'tool-call': {
                const assistant = ensureAssistant();
                const optionBlock = extractOptions(message);
                if (optionBlock.length > 0) {
                    // AskUserQuestion 之类的选项工具直接映射为 options[]，而不是折叠工具块。
                    assistant.options.push(...optionBlock);
                    const imageMarkdown = extractInlineImageMarkdown(message, attachmentUrls);
                    if (imageMarkdown) {
                        assistant.markdownParts.push(imageMarkdown);
                    }
                    break;
                }
                const imageMarkdown = extractInlineImageMarkdown(message, attachmentUrls);
                if (imageMarkdown) {
                    // 图片附件工具：直接把图片内联进正文，不当作折叠工具活动。
                    assistant.markdownParts.push(imageMarkdown);
                    break;
                }
                assistant.tools.push(toolToEnvelope(message));
                break;
            }
            case 'agent-event': {
                const text = formatAgentEvent(message.event);
                if (!text) {
                    break;
                }
                ensureAssistant().markdownParts.push(`_${text}_`);
                break;
            }
        }
    }
    flushAssistant();

    return {
        temp: true,
        theme: options.theme ?? 'document',
        meta: buildMeta(session, sharedAt, turns.length),
        turns,
    };
}

export function hasOpenBirdShareContent(messages: Message[]): boolean {
    return messages.some(hasRenderableMessageContent);
}

// --- meta ---

function buildMeta(session: Session, sharedAt: number, turnCount: number): OpenBirdEnvelopeMeta {
    return {
        title: getSessionShareTitle(session),
        model: resolveModel(session),
        source: 'Happy',
        date: new Date(sharedAt).toISOString().slice(0, 10),
        turnCount,
    };
}

function getSessionShareTitle(session: Session): string {
    return session.metadata?.summary?.text?.trim()
        || session.metadata?.name?.trim()
        || session.metadata?.path?.trim()
        || 'Happy Session';
}

function resolveModel(session: Session): string | null {
    const code = session.modelMode ?? session.metadata?.currentModelCode ?? null;
    return typeof code === 'string' && code.trim().length > 0 ? code.trim() : null;
}

// --- tools ---

function toolToEnvelope(message: ToolCallMessage): OpenBirdEnvelopeTool {
    const { tool } = message;
    const title = toolTitle(message);
    const steps: string[] = [];

    if (tool.description && oneLine(tool.description) && oneLine(tool.description) !== title) {
        steps.push(oneLine(tool.description));
    }
    const inputStep = summarizeToolInput(tool.name, tool.input);
    if (inputStep) {
        steps.push(inputStep);
    }
    // 子消息（嵌套工具 / 子代理输出）压平成 step 文本。
    for (const child of sortMessagesForShare(message.children)) {
        const childStep = childToStep(child);
        if (childStep) {
            steps.push(childStep);
        }
    }

    return { title, steps: dedupe(steps).slice(0, 12) };
}

function toolTitle(message: ToolCallMessage): string {
    const { tool } = message;
    const desc = tool.description ? oneLine(tool.description) : '';
    const name = oneLine(tool.name) || 'Tool';
    if (desc) {
        return `${name} · ${truncate(desc, 80)}`;
    }
    const inputHint = shortInputHint(tool.name, tool.input);
    return inputHint ? `${name} · ${inputHint}` : name;
}

function shortInputHint(name: string, input: unknown): string | null {
    if (!isObject(input)) {
        return null;
    }
    for (const key of ['file_path', 'path', 'pattern', 'command', 'query', 'url', 'ref']) {
        const value = input[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return truncate(oneLine(value), 60);
        }
    }
    return null;
}

function summarizeToolInput(name: string, input: unknown): string | null {
    if (input === undefined || input === null) {
        return null;
    }
    if (typeof input === 'string') {
        const line = oneLine(input);
        return line.length > 0 ? truncate(line, 160) : null;
    }
    if (isObject(input)) {
        const hint = shortInputHint(name, input);
        if (hint) {
            return hint;
        }
        const json = truncate(oneLine(safeStringify(input)), 160);
        return json.length > 0 ? json : null;
    }
    return null;
}

function childToStep(child: Message): string | null {
    switch (child.kind) {
        case 'tool-call':
            return toolTitle(child);
        case 'agent-text':
            return child.isThinking ? null : truncate(oneLine(child.text), 160) || null;
        case 'user-text':
            return truncate(oneLine(child.displayText ?? child.text), 160) || null;
        case 'agent-event': {
            const text = formatAgentEvent(child.event);
            return text ? truncate(oneLine(text), 160) : null;
        }
    }
}

// --- options ---

function extractOptions(message: ToolCallMessage): OpenBirdEnvelopeOption[] {
    const { tool } = message;
    if (tool.name !== 'AskUserQuestion' || !isObject(tool.input)) {
        return [];
    }
    const questions = tool.input.questions;
    if (!Array.isArray(questions)) {
        return [];
    }
    const selectedLabels = collectSelectedLabels(tool.result);
    const options: OpenBirdEnvelopeOption[] = [];
    for (const question of questions) {
        if (!isObject(question) || !Array.isArray(question.options)) {
            continue;
        }
        for (const opt of question.options) {
            if (!isObject(opt) || typeof opt.label !== 'string') {
                continue;
            }
            const label = opt.label.trim();
            if (label.length === 0) {
                continue;
            }
            options.push({ label, selected: selectedLabels.has(label) });
        }
    }
    return options;
}

/** 从工具结果里抽出用户实际选中的选项 label（尽力而为，兼容多种结果形状）。 */
function collectSelectedLabels(result: unknown): Set<string> {
    const labels = new Set<string>();
    const visit = (value: unknown, depth: number) => {
        if (depth > 6 || value === null || value === undefined) {
            return;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                labels.add(trimmed);
            }
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item, depth + 1);
            }
            return;
        }
        if (isObject(value)) {
            for (const key of ['label', 'selected', 'selectedOption', 'choice', 'answer', 'value']) {
                if (key in value) {
                    visit(value[key], depth + 1);
                }
            }
        }
    };
    visit(result, 0);
    return labels;
}

// --- images ---

function extractInlineImageMarkdown(
    message: ToolCallMessage,
    attachmentUrls: Record<string, string>,
): string | null {
    const { tool } = message;
    if (tool.name !== 'file' || !isObject(tool.input)) {
        return null;
    }
    const input = tool.input;
    if (typeof input.ref !== 'string' || !isObject(input.image)) {
        return null;
    }
    const url = attachmentUrls[input.ref];
    if (!url) {
        return null;
    }
    const alt = typeof input.name === 'string' && input.name.trim().length > 0
        ? input.name.trim()
        : 'image';
    return `![${escapeMarkdownAlt(alt)}](${url})`;
}

/**
 * 把散落在会话里、已上传的图片 URL 内联进任意 markdown 文本。
 * 支持文本里以 `attachment://<ref>` 或裸 `<ref>` 引用图片的情况（尽力而为）。
 */
function inlineAttachments(text: string, attachmentUrls: Record<string, string>): string {
    if (Object.keys(attachmentUrls).length === 0) {
        return text;
    }
    let result = text;
    for (const [ref, url] of Object.entries(attachmentUrls)) {
        if (!ref) {
            continue;
        }
        result = result.split(`attachment://${ref}`).join(url);
    }
    return result;
}

// --- shared helpers ---

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
            return typeof event.endsAt === 'number'
                ? `Usage limit reached until ${new Date(event.endsAt).toISOString()}.`
                : 'Usage limit reached.';
        case 'ready':
            return 'Agent ready.';
        default:
            return null;
    }
}

function joinMarkdown(parts: string[]): string {
    return parts.map(part => part.trim()).filter(part => part.length > 0).join('\n\n').trim();
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
    if (value.length <= max) {
        return value;
    }
    return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function dedupe(values: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        if (value.length === 0 || seen.has(value)) {
            continue;
        }
        seen.add(value);
        out.push(value);
    }
    return out;
}

function escapeMarkdownAlt(value: string): string {
    return value.replace(/[[\]]/g, '\\$&');
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
