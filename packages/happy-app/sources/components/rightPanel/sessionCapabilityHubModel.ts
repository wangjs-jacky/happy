import type { DecryptedArtifact } from '@/sync/artifactTypes';
import type { QuickPrompt } from '@/sync/settings';
import type { Session } from '@/sync/storageTypes';
import type { Message } from '@/sync/typesMessage';

export type CapabilityKey = 'skills' | 'quickPrompts' | 'images' | 'artifacts' | 'files';

export type SkillCapabilityItem = {
    id: string;
    kind: 'skill';
    title: string;
    meta: 'available';
};

export type ImageCapabilityItem = {
    id: string;
    kind: 'image';
    title: string;
    meta: 'session';
    ref: string;
    source?: 'user' | 'generated';
    messageId: string;
    createdAt: number;
    width?: number;
    height?: number;
    thumbhash?: string;
};

export type ArtifactCapabilityItem = {
    id: string;
    kind: 'artifact';
    title: string;
    meta: 'session';
    artifactId: string;
    createdAt: number;
    updatedAt: number;
};

export type FileCapabilityItem = {
    id: string;
    kind: 'file';
    title: string;
    meta: 'session';
    path: string;
    toolName: string;
    messageId: string;
    createdAt: number;
};

export type QuickPromptCapabilityItem = {
    id: string;
    kind: 'quickPrompt';
    title: string;
    meta: 'custom';
    prompt: string;
    createdAt?: number;
    updatedAt?: number;
};

export type CapabilityItem =
    | SkillCapabilityItem
    | QuickPromptCapabilityItem
    | ImageCapabilityItem
    | ArtifactCapabilityItem
    | FileCapabilityItem;

export type CapabilityItemsByKey = {
    skills: SkillCapabilityItem;
    quickPrompts: QuickPromptCapabilityItem;
    images: ImageCapabilityItem;
    artifacts: ArtifactCapabilityItem;
    files: FileCapabilityItem;
};

type CapabilityDetails = {
    [K in CapabilityKey]: CapabilityItemsByKey[K][];
};

export type CapabilityBlock = {
    key: CapabilityKey;
    count: number;
    preview: string | null;
    empty: boolean;
};

export type SessionCapabilityHubModel = {
    blocks: CapabilityBlock[];
    details: Record<CapabilityKey, CapabilityItem[]>;
};

type BuildArgs = {
    session: Session | null;
    messages: Message[];
    artifacts: DecryptedArtifact[];
    quickPrompts?: QuickPrompt[] | null;
    skillNames?: string[] | null;
    limits?: {
        details?: number;
    };
};

const DETAIL_KEYS: CapabilityKey[] = ['skills', 'quickPrompts', 'images', 'artifacts', 'files'];
const DEFAULT_DETAIL_LIMIT = Number.POSITIVE_INFINITY;
const EDIT_TOOL_NAMES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const PATCH_TOOL_NAMES = new Set(['CodexPatch', 'GeminiPatch']);

type PatchEntry = {
    path: string;
};

type FileImageInput = {
    ref: string;
    name?: string;
    source?: 'user' | 'generated';
    image?: {
        width?: number;
        height?: number;
        thumbhash?: string;
    };
};

function isToolMessage(message: Message): message is Extract<Message, { kind: 'tool-call' }> {
    return message.kind === 'tool-call';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getMetadataSkills(session: Session | null): string[] {
    const skills = session?.metadata?.skills;
    return Array.isArray(skills) ? skills.filter((value): value is string => typeof value === 'string' && value.length > 0) : [];
}

function getArtifactItems(session: Session | null, artifacts: DecryptedArtifact[], limit: number): ArtifactCapabilityItem[] {
    if (!session) return [];
    return artifacts
        .filter((artifact) => !artifact.draft && Array.isArray(artifact.sessions) && artifact.sessions.includes(session.id))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map((artifact) => ({
            id: artifact.id,
            kind: 'artifact',
            title: artifact.title || 'Untitled',
            meta: 'session',
            artifactId: artifact.id,
            createdAt: artifact.createdAt,
            updatedAt: artifact.updatedAt,
        }));
}

function parseFileImageInput(input: unknown): FileImageInput | null {
    if (!isRecord(input)) return null;
    const ref = typeof input.ref === 'string' ? input.ref : null;
    if (!ref) return null;
    const image = isRecord(input.image) ? input.image : undefined;
    return {
        ref,
        name: typeof input.name === 'string' ? input.name : undefined,
        source: input.source === 'generated' || input.source === 'user' ? input.source : undefined,
        image: image ? {
            width: typeof image.width === 'number' ? image.width : undefined,
            height: typeof image.height === 'number' ? image.height : undefined,
            thumbhash: typeof image.thumbhash === 'string' ? image.thumbhash : undefined,
        } : undefined,
    };
}

function getImageItems(messages: Message[], limit: number): ImageCapabilityItem[] {
    const items: ImageCapabilityItem[] = [];

    for (const message of messages) {
        if (!isToolMessage(message) || message.tool.name !== 'file') continue;
        const parsed = parseFileImageInput(message.tool.input);
        if (!parsed) continue;
        items.push({
            id: message.id,
            kind: 'image',
            title: parsed.name || 'Image',
            meta: 'session',
            ref: parsed.ref,
            ...(parsed.source ? { source: parsed.source } : {}),
            messageId: message.id,
            createdAt: message.createdAt,
            ...(parsed.image?.width !== undefined ? { width: parsed.image.width } : {}),
            ...(parsed.image?.height !== undefined ? { height: parsed.image.height } : {}),
            ...(parsed.image?.thumbhash !== undefined ? { thumbhash: parsed.image.thumbhash } : {}),
        });
    }

    return items.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

function getPatchPaths(input: unknown): string[] {
    const paths: string[] = [];

    const collectFromObject = (value: unknown) => {
        if (!isRecord(value)) return;
        for (const key of Object.keys(value)) {
            if (typeof key === 'string' && key.length > 0) {
                paths.push(key);
            }
        }
    };

    const collectFromArray = (value: unknown) => {
        if (!Array.isArray(value)) return;
        for (const item of value) {
            if (!isRecord(item)) continue;
            if (typeof item.path === 'string' && item.path.length > 0) {
                paths.push(item.path);
            }
        }
    };

    if (!isRecord(input)) return paths;
    collectFromObject(input.changes);
    collectFromObject(input.fileChanges);
    collectFromArray(input.changes);
    collectFromArray(input.fileChanges);
    return paths;
}

function getSingleFilePath(input: unknown): string | null {
    if (!isRecord(input)) return null;
    const direct = ['file_path', 'target_file', 'path', 'notebook_path'];
    for (const key of direct) {
        const value = input[key];
        if (typeof value === 'string' && value.length > 0) {
            return value;
        }
    }
    return null;
}

function getFileItems(messages: Message[], limit: number): FileCapabilityItem[] {
    const sorted = messages
        .filter(isToolMessage)
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt);

    const items: FileCapabilityItem[] = [];
    const seen = new Set<string>();

    for (const message of sorted) {
        const toolName = message.tool.name;
        const paths: string[] = [];

        if (EDIT_TOOL_NAMES.has(toolName)) {
            const singlePath = getSingleFilePath(message.tool.input);
            if (singlePath) paths.push(singlePath);
        }
        if (PATCH_TOOL_NAMES.has(toolName)) {
            paths.push(...getPatchPaths(message.tool.input));
        }

        for (const path of paths) {
            if (!path || seen.has(path)) continue;
            seen.add(path);
            items.push({
                id: `${message.id}:${path}`,
                kind: 'file',
                title: path.split('/').pop() || path,
                meta: 'session',
                path,
                toolName,
                messageId: message.id,
                createdAt: message.createdAt,
            });
            if (items.length >= limit) {
                return items;
            }
        }
    }

    return items;
}

function getSkillItems(session: Session | null, skillNames: string[] | null | undefined, limit: number): SkillCapabilityItem[] {
    const skills = skillNames && skillNames.length > 0 ? skillNames : getMetadataSkills(session);
    return skills
        .slice(0, limit)
        .map((skill) => ({
            id: skill,
            kind: 'skill',
            title: skill,
            meta: 'available',
        }));
}

function getQuickPromptItems(quickPrompts: QuickPrompt[] | null | undefined, limit: number): QuickPromptCapabilityItem[] {
    if (!Array.isArray(quickPrompts)) return [];
    return quickPrompts
        .filter((item) => item.title.trim().length > 0 && item.prompt.trim().length > 0)
        .slice()
        .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
        .slice(0, limit)
        .map((item) => ({
            id: item.id,
            kind: 'quickPrompt',
            title: item.title,
            meta: 'custom',
            prompt: item.prompt,
            ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
            ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
        }));
}

function getPreview(items: CapabilityItem[]): string | null {
    if (items.length === 0) return null;
    return items[0]?.title ?? null;
}

export function getCapabilityDetailItems<K extends CapabilityKey>(key: K, args: BuildArgs): CapabilityItemsByKey[K][] {
    const limit = args.limits?.details ?? DEFAULT_DETAIL_LIMIT;

    switch (key) {
        case 'skills':
            return getSkillItems(args.session, args.skillNames, limit) as CapabilityItemsByKey[K][];
        case 'quickPrompts':
            return getQuickPromptItems(args.quickPrompts, limit) as CapabilityItemsByKey[K][];
        case 'images':
            return getImageItems(args.messages, limit) as CapabilityItemsByKey[K][];
        case 'artifacts':
            return getArtifactItems(args.session, args.artifacts, limit) as CapabilityItemsByKey[K][];
        case 'files':
            return getFileItems(args.messages, limit) as CapabilityItemsByKey[K][];
    }
}

export function buildSessionCapabilityHubModel(args: BuildArgs): SessionCapabilityHubModel {
    const details: CapabilityDetails = {
        skills: getCapabilityDetailItems('skills', args),
        quickPrompts: getCapabilityDetailItems('quickPrompts', args),
        images: getCapabilityDetailItems('images', args),
        artifacts: getCapabilityDetailItems('artifacts', args),
        files: getCapabilityDetailItems('files', args),
    };

    const blocks = DETAIL_KEYS.map((key) => {
        const items = details[key];
        return {
            key,
            count: items.length,
            preview: getPreview(items),
            empty: items.length === 0,
        };
    });

    return {
        blocks,
        details,
    };
}
