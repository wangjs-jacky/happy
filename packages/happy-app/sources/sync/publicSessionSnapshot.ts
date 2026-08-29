import * as path from 'path';
import { v4 as uuid } from 'uuid';
import type { Message, ToolCallMessage } from './typesMessage';
import type {
    PublicSessionAttachmentJob,
    PublicSessionAttachmentKind,
    PublicSessionMessageV1,
    PublicSessionSnapshotV1,
} from './publicSessionShareTypes';

const PRIVATE_TOOL_KEYS = new Set([
    'sessionId',
    'machineId',
    'localPath',
    'permission',
    'permissions',
    'ref',
    'token',
    'accessToken',
    'secret',
]);

function sanitizeToolValue(value: unknown, depth = 0): unknown {
    if (depth > 8) return '[nested content omitted]';
    if (typeof value === 'string') return value.slice(0, 200_000);
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => sanitizeToolValue(item, depth + 1));
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([key]) => !PRIVATE_TOOL_KEYS.has(key))
                .map(([key, child]) => [key, sanitizeToolValue(child, depth + 1)]),
        );
    }
    return String(value);
}

function stringifyToolBody(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    const sanitized = sanitizeToolValue(value);
    const serialized = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized, null, 2);
    return serialized?.slice(0, 2_000_000) || undefined;
}

function safeAttachmentName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) return 'attachment';
    return path.posix.basename(name.replace(/\\/g, '/')) || 'attachment';
}

function attachmentKind(value: unknown): PublicSessionAttachmentKind {
    return value === 'audio' || value === 'video' || value === 'file' ? value : 'image';
}

function defaultMimeType(kind: PublicSessionAttachmentKind, name: string): string {
    const extension = path.extname(name).toLowerCase();
    if (kind === 'image') {
        if (extension === '.png') return 'image/png';
        if (extension === '.gif') return 'image/gif';
        if (extension === '.webp') return 'image/webp';
        return 'image/jpeg';
    }
    if (kind === 'audio') return extension === '.wav' ? 'audio/wav' : 'audio/mpeg';
    if (kind === 'video') return extension === '.webm' ? 'video/webm' : 'video/mp4';
    if (extension === '.pdf') return 'application/pdf';
    return 'application/octet-stream';
}

function mapFileTool(
    message: ToolCallMessage,
    attachmentByRef: Map<string, PublicSessionAttachmentJob>,
    createAttachmentId: () => string,
): { block: Extract<PublicSessionMessageV1['blocks'][number], { type: 'attachment' }>; job: PublicSessionAttachmentJob } | null {
    const input = message.tool.input;
    if (!input || typeof input !== 'object' || typeof input.ref !== 'string' || !input.ref) return null;
    const ref = input.ref;
    const existing = attachmentByRef.get(ref);
    if (existing) {
        return {
            job: existing,
            block: {
                type: 'attachment',
                attachmentId: existing.attachmentId,
                kind: existing.kind,
                name: existing.name,
                mimeType: existing.mimeType,
                size: existing.size,
            },
        };
    }
    const kind = attachmentKind(input.kind);
    const name = safeAttachmentName(input.name);
    const job: PublicSessionAttachmentJob = {
        attachmentId: createAttachmentId(),
        sourceRef: ref,
        encrypted: input.encrypted !== false,
        kind,
        name,
        mimeType: typeof input.mimeType === 'string' && input.mimeType ? input.mimeType : defaultMimeType(kind, name),
        size: typeof input.size === 'number' && Number.isFinite(input.size) ? Math.max(0, Math.trunc(input.size)) : 0,
    };
    attachmentByRef.set(ref, job);
    return {
        job,
        block: {
            type: 'attachment',
            attachmentId: job.attachmentId,
            kind: job.kind,
            name: job.name,
            mimeType: job.mimeType,
            size: job.size,
        },
    };
}

export function buildPublicSessionSnapshot(input: {
    title: string;
    messages: Message[];
    sharedAt: number;
    createAttachmentId?: () => string;
}): { snapshot: PublicSessionSnapshotV1; attachments: PublicSessionAttachmentJob[] } {
    const createAttachmentId = input.createAttachmentId ?? uuid;
    const attachmentByRef = new Map<string, PublicSessionAttachmentJob>();
    const publicMessages: PublicSessionMessageV1[] = [];

    const visit = (message: Message) => {
        if (message.kind === 'user-text') {
            const markdown = (message.displayText ?? message.text).trim();
            if (markdown) publicMessages.push({ id: message.id, role: 'user', createdAt: message.createdAt, blocks: [{ type: 'text', markdown }] });
            return;
        }
        if (message.kind === 'agent-text') {
            const markdown = message.text.trim();
            if (markdown) {
                publicMessages.push({
                    id: message.id,
                    role: 'assistant',
                    createdAt: message.createdAt,
                    blocks: [{ type: message.isThinking ? 'thinking' : 'text', markdown }],
                });
            }
            return;
        }
        if (message.kind === 'agent-event') {
            const event = message.event;
            if (event.type === 'message' && event.message.trim()) {
                publicMessages.push({ id: message.id, role: 'system', createdAt: message.createdAt, blocks: [{ type: 'text', markdown: event.message.trim() }] });
            }
            return;
        }

        if (message.tool.name === 'file') {
            const mapped = mapFileTool(message, attachmentByRef, createAttachmentId);
            if (mapped) {
                publicMessages.push({ id: message.id, role: 'assistant', createdAt: message.createdAt, blocks: [mapped.block] });
            }
        } else {
            const body = stringifyToolBody(message.tool.result ?? message.tool.input);
            publicMessages.push({
                id: message.id,
                role: 'assistant',
                createdAt: message.createdAt,
                blocks: [{
                    type: 'tool',
                    name: message.tool.name,
                    status: message.tool.state === 'error' ? 'failed' : message.tool.state,
                    ...(message.tool.description ? { title: message.tool.description } : {}),
                    ...(body ? { body } : {}),
                }],
            });
        }
        for (const child of message.children) visit(child);
    };

    for (const message of input.messages) visit(message);
    return {
        snapshot: {
            version: 1,
            title: input.title.trim() || 'Shared session',
            sharedAt: input.sharedAt,
            messages: publicMessages,
        },
        attachments: Array.from(attachmentByRef.values()),
    };
}
