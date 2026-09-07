import { isAbsolute } from 'node:path';
import type { PublicSessionBlock } from '@slopus/happy-wire';
import { resolveStructuredAttachment } from './shared';
import type { ResolvedAttachment, TranscriptCandidate } from './types';

export type PawsLocalAttachmentReference = {
    reference: string;
    kind: 'audio' | 'video' | 'file';
    mimeType: string;
};

export type ParsedPawsLocalAttachmentNotice = {
    matched: boolean;
    malformed: boolean;
    visibleText: string;
    references: PawsLocalAttachmentReference[];
};

export type MaterializedPawsLocalAttachmentNotice = {
    matched: boolean;
    visibleText: string;
    blocks: Array<Extract<PublicSessionBlock, { type: 'attachment' }>>;
    attachments: ResolvedAttachment[];
    unresolvedAttachments: string[];
};

const DOCUMENT_INSTRUCTION = 'Use the exact local file path above to read or process the PDF according to the user request.';
const MEDIA_INSTRUCTION = 'Audio/video content is available at the exact paths above; use command-line tools such as ffmpeg or whisper when needed.';
const SAFETY_INSTRUCTION = 'Do not scan ~/.happy/attachments or guess which file the user intended.';

function malformedNotice(): ParsedPawsLocalAttachmentNotice {
    return { matched: true, malformed: true, visibleText: '', references: [] };
}

export function parsePawsLocalAttachmentNotice(value: string): ParsedPawsLocalAttachmentNotice {
    const lines = value.replace(/\r\n/g, '\n').split('\n');
    const headerIndex = lines.findIndex((line) => /^Happy attached \d+ user-uploaded local files? to this turn:$/.test(line));
    if (headerIndex < 0) return { matched: false, malformed: false, visibleText: value, references: [] };

    const countMatch = /^Happy attached (\d+) user-uploaded local files? to this turn:$/.exec(lines[headerIndex]);
    const count = Number(countMatch?.[1]);
    if (!Number.isSafeInteger(count) || count < 1 || count > 100) return malformedNotice();

    const references: PawsLocalAttachmentReference[] = [];
    let cursor = headerIndex + 1;
    for (let index = 1; index <= count; index += 1, cursor += 1) {
        const match = /^- (Audio|Video|File) (\d+): (.+) \(([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+), ([^)]+)\)$/.exec(lines[cursor] ?? '');
        if (!match || Number(match[2]) !== index || !isAbsolute(match[3])) return malformedNotice();
        const kind = match[1].toLowerCase() as PawsLocalAttachmentReference['kind'];
        if ((kind === 'audio' && !match[4].startsWith('audio/'))
            || (kind === 'video' && !match[4].startsWith('video/'))) return malformedNotice();
        references.push({ reference: match[3], kind, mimeType: match[4] });
    }

    if (lines[cursor] === DOCUMENT_INSTRUCTION) cursor += 1;
    if (lines[cursor] === MEDIA_INSTRUCTION) cursor += 1;
    if (lines[cursor] !== SAFETY_INSTRUCTION) return malformedNotice();
    cursor += 1;

    return {
        matched: true,
        malformed: false,
        visibleText: [...lines.slice(0, headerIndex), ...lines.slice(cursor)].join('\n').trim(),
        references,
    };
}

export async function materializePawsLocalAttachmentNotice(options: {
    value: string;
    candidate: TranscriptCandidate;
    recordedCwd?: string;
    keyPrefix: string;
}): Promise<MaterializedPawsLocalAttachmentNotice> {
    const parsed = parsePawsLocalAttachmentNotice(options.value);
    if (!parsed.matched) {
        return { matched: false, visibleText: options.value, blocks: [], attachments: [], unresolvedAttachments: [] };
    }
    if (parsed.malformed) {
        return {
            matched: true,
            visibleText: '',
            blocks: [],
            attachments: [],
            unresolvedAttachments: [`${options.keyPrefix}:local-attachments`],
        };
    }

    const blocks: MaterializedPawsLocalAttachmentNotice['blocks'] = [];
    const attachments: ResolvedAttachment[] = [];
    const unresolvedAttachments: string[] = [];
    for (const [index, reference] of parsed.references.entries()) {
        try {
            const resolved = await resolveStructuredAttachment(options.candidate, reference.reference, options.recordedCwd);
            const attachment = { ...resolved, kind: reference.kind, mimeType: reference.mimeType };
            attachments.push(attachment);
            blocks.push({
                type: 'attachment',
                attachmentId: attachment.attachmentId,
                kind: attachment.kind,
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: attachment.size,
                source: 'user',
            });
        } catch {
            unresolvedAttachments.push(`${options.keyPrefix}:local-attachment:${index}`);
        }
    }
    return { matched: true, visibleText: parsed.visibleText, blocks, attachments, unresolvedAttachments };
}
