export type AutoFoldPromptInfo = {
    charCount: number;
    lineCount: number;
    preview: string;
};

const MIN_PROMPT_CHARS = 1400;
const MIN_PROMPT_LINES = 10;
const LONG_SINGLE_BLOCK_CHARS = 2400;
const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 720;

const PROMPT_MARKERS = [
    /\bprompt\b/i,
    /\bsystem prompt\b/i,
    /\bstyle prompt\b/i,
    /\bimage prompt\b/i,
    /\bgeneration prompt\b/i,
    /\bnegative prompt\b/i,
    /提示词/,
    /提示詞/,
    /提示語/,
    /风格提示/,
    /風格提示/,
    /图像提示/,
    /圖像提示/,
    /生成提示/,
    /完整提示/,
];

const IMAGE_BATCH_MARKERS = [
    /\$gpt-image-2/,
    /GPT Image 2/i,
    /图片编辑\s*\/\s*生成批处理/,
    /mcp__happy__send_image/,
    /生成锁/,
];

export function isGeneratedImageBatchPromptText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    const markerSearchText = trimmed.slice(0, 1800);
    return IMAGE_BATCH_MARKERS.every((marker) => marker.test(markerSearchText));
}

function buildPreview(text: string): string {
    const linePreview = text.split('\n').slice(0, PREVIEW_LINES).join('\n').trim();
    if (linePreview.length <= PREVIEW_CHARS) {
        return linePreview;
    }
    return `${linePreview.slice(0, PREVIEW_CHARS).trimEnd()}...`;
}

export function getAutoFoldPromptInfo(text: string): AutoFoldPromptInfo | null {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }

    const charCount = trimmed.length;
    const lineCount = trimmed.split('\n').length;

    if (isGeneratedImageBatchPromptText(trimmed) && charCount >= 180 && lineCount >= 6) {
        return {
            charCount,
            lineCount,
            preview: buildPreview(trimmed),
        };
    }

    const isLongEnough = charCount >= LONG_SINGLE_BLOCK_CHARS || (charCount >= MIN_PROMPT_CHARS && lineCount >= MIN_PROMPT_LINES);
    if (!isLongEnough) {
        return null;
    }

    const markerSearchText = trimmed.slice(0, 1800);
    if (!PROMPT_MARKERS.some((marker) => marker.test(markerSearchText))) {
        return null;
    }

    return {
        charCount,
        lineCount,
        preview: buildPreview(trimmed),
    };
}
