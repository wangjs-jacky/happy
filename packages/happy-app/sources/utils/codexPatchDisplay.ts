export type CodexPatchDisplayEntry = {
    diff?: string;
    unified_diff?: string;
    kind?: {
        type?: string;
        move_path?: string | null;
    };
    content?: string;
    oldContent?: string;
    newContent?: string;
    old_content?: string;
    new_content?: string;
    add?: {
        content?: string;
    };
    modify?: {
        old_content?: string;
        new_content?: string;
    };
    delete?: {
        content?: string;
    };
};

export function shouldExpandCodexPatchByDefault(change: CodexPatchDisplayEntry): boolean {
    if (hasText(change.diff) || hasText(change.unified_diff)) {
        return true;
    }

    if (change.modify && (hasText(change.modify.old_content) || hasText(change.modify.new_content))) {
        return true;
    }

    if (hasText(change.oldContent) || hasText(change.newContent)) {
        return true;
    }

    if (hasText(change.old_content) || hasText(change.new_content)) {
        return true;
    }

    if (change.add && hasText(change.add.content)) {
        return true;
    }

    if (change.delete && hasText(change.delete.content)) {
        return true;
    }

    return hasText(change.content);
}

function hasText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}
