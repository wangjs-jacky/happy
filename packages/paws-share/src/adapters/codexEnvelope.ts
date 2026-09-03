const SYSTEM_PROMPT_BLOCK = /<!-- happy:system-prompt:start -->[\s\S]*?<!-- happy:system-prompt:end -->/g;
const PAWS_ORIGIN_COMMENT = /<!-- happy:paws-origin:[\s\S]*?-->/g;
const GENERATED_ATTACHMENT_NOTICE = /^[\t\r\n ]*Happy attached \d+ user-uploaded images? to this Codex turn\.[\s\S]*?(?=<!-- happy:(?:paws-origin:|system-prompt:start))/i;

function textValue(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const block = value as Record<string, unknown>;
    return block.type === 'input_text' && typeof block.text === 'string' ? block.text : null;
}

export function isSyntheticPawsCodexText(value: string): boolean {
    const text = value.trimStart();
    return text.startsWith('<recommended_plugins>')
        || (text.startsWith('# AGENTS.md instructions') && text.includes('<INSTRUCTIONS>'))
        || text.startsWith('<environment_context>');
}

export function isSyntheticPawsCodexMessage(content: unknown[]): boolean {
    return content.length > 0 && content.every((block) => {
        const text = textValue(block);
        return text !== null && isSyntheticPawsCodexText(text);
    });
}

export function visiblePawsCodexUserText(value: string): string {
    let text = value
        .replace(/^\s*<image name=\[Image #\d+\] path="[^"\r\n]+">\s*$/gm, '')
        .replace(/^\s*<\/image>\s*$/gm, '')
        .replace(GENERATED_ATTACHMENT_NOTICE, '')
        .replace(SYSTEM_PROMPT_BLOCK, '')
        .replace(PAWS_ORIGIN_COMMENT, '');
    const unclosedSystemPrompt = text.indexOf('<!-- happy:system-prompt:start -->');
    if (unclosedSystemPrompt >= 0) text = text.slice(0, unclosedSystemPrompt);
    return text.replace(/\n{3,}/g, '\n\n').trim();
}
