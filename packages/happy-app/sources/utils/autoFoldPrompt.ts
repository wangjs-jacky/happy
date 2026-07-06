export type AutoFoldPromptInfo = {
    charCount: number;
    lineCount: number;
    preview: string;
    content: string;
};

const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 720;

export const FOLD_PROMPT_OPEN_TAG = '<happy-fold-prompt>';
export const FOLD_PROMPT_CLOSE_TAG = '</happy-fold-prompt>';

function buildPreview(text: string): string {
    const linePreview = text.split('\n').slice(0, PREVIEW_LINES).join('\n').trim();
    if (linePreview.length <= PREVIEW_CHARS) {
        return linePreview;
    }
    return `${linePreview.slice(0, PREVIEW_CHARS).trimEnd()}...`;
}

export function getAutoFoldPromptInfo(text: string): AutoFoldPromptInfo | null {
    const openIndex = text.indexOf(FOLD_PROMPT_OPEN_TAG);
    const closeIndex = text.indexOf(FOLD_PROMPT_CLOSE_TAG);
    if (openIndex < 0 || closeIndex <= openIndex) {
        return null;
    }

    const contentStart = openIndex + FOLD_PROMPT_OPEN_TAG.length;
    const content = text.slice(contentStart, closeIndex).trim();
    if (!content) {
        return null;
    }

    const charCount = content.length;
    const lineCount = content.split('\n').length;

    return {
        charCount,
        lineCount,
        preview: buildPreview(content),
        content,
    };
}
