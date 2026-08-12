import type { ForkSource, SpawnSessionResult } from '@/sync/ops';
import { resolveInitialForkRewindPointId } from './messageForkPoint';

type DirectMessageForkInput = {
    source: ForkSource | null;
    messageId: string;
    rewindPointId: string | undefined;
    messageText: string;
};

export type DirectMessageForkResult =
    | SpawnSessionResult
    | { type: 'missing-source' }
    | { type: 'missing-rewind-point' }
    | { type: 'ambiguous-rewind-point' };

type DirectMessageForkDependencies = {
    listCodexRewindPoints: (input: {
        machineId: string;
        directory: string;
        codexThreadId: string;
    }) => Promise<
        | { type: 'success'; points: Array<{ itemId: string; text: string; timestamp: number }> }
        | { type: 'error'; errorMessage: string }
    >;
    spawnFork: (
        source: ForkSource,
        options: {
            cutAfterUuid?: string;
            cutAfterItemId?: string;
            forkedFromMessageId?: string;
            retainSelectedTurn?: boolean;
        },
    ) => Promise<SpawnSessionResult>;
};

export async function directMessageFork(
    input: DirectMessageForkInput,
    dependencies: DirectMessageForkDependencies,
): Promise<DirectMessageForkResult> {
    const { source } = input;
    if (!source) return { type: 'missing-source' };

    let rewindPointId = input.rewindPointId;
    if (source.kind === 'codex' && !rewindPointId) {
        const pointsResult = await dependencies.listCodexRewindPoints({
            machineId: source.machineId,
            directory: source.directory,
            codexThreadId: source.codexThreadId,
        });
        if (pointsResult.type !== 'success') return pointsResult;

        const candidates = pointsResult.points.map((point) => ({ id: point.itemId, text: point.text }));
        rewindPointId = resolveInitialForkRewindPointId(
            candidates,
            undefined,
            input.messageText,
            true,
        ) ?? undefined;
        if (rewindPointId) {
            const normalizedTarget = normalizeMessageText(input.messageText);
            const matchCount = candidates.filter(
                (candidate) => normalizeMessageText(candidate.text) === normalizedTarget,
            ).length;
            if (matchCount > 1) return { type: 'ambiguous-rewind-point' };
        }
    }

    if (!rewindPointId) return { type: 'missing-rewind-point' };

    return source.kind === 'codex'
        ? dependencies.spawnFork(source, {
            cutAfterItemId: rewindPointId,
            forkedFromMessageId: input.messageId,
            retainSelectedTurn: true,
        })
        : dependencies.spawnFork(source, {
            cutAfterUuid: rewindPointId,
            forkedFromMessageId: input.messageId,
        });
}

function normalizeMessageText(text: string): string {
    return text.trim().replace(/\s+/g, ' ');
}
