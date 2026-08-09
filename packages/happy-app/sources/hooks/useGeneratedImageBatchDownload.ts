import * as React from 'react';

import { useHappyAction } from '@/hooks/useHappyAction';
import {
    downloadImageBatch,
    type ImageBatchDownloadDestination,
    type ImageBatchDownloadItem,
    type ImageBatchDownloadProgress,
} from '@/utils/imageBatchDownload';
import { AsyncLock } from '@/utils/lock';

type DownloadSummary = {
    succeeded: number;
    failed: number;
    cancelled: boolean;
    destination: ImageBatchDownloadDestination;
};

type BatchDownloadSnapshot = {
    operationId: number;
    busy: boolean;
    progress: Pick<ImageBatchDownloadProgress, 'completed' | 'total'> | null;
    failedIds: string[];
    summary: DownloadSummary | null;
};

const emptyBatchDownloadSnapshot: BatchDownloadSnapshot = {
    operationId: 0,
    busy: false,
    progress: null,
    failedIds: [],
    summary: null,
};

let nextOperationId = 0;
let batchDownloadSnapshots: ReadonlyMap<string, BatchDownloadSnapshot> = new Map();
const batchDownloadListeners = new Set<() => void>();
const batchDownloadLocks = new Map<string, AsyncLock>();

function publishBatchDownloadSnapshot(ownerKey: string, snapshot: BatchDownloadSnapshot) {
    const nextSnapshots = new Map(batchDownloadSnapshots);
    nextSnapshots.set(ownerKey, snapshot);
    batchDownloadSnapshots = nextSnapshots;
    for (const listener of batchDownloadListeners) listener();
}

function subscribeBatchDownload(listener: () => void) {
    batchDownloadListeners.add(listener);
    return () => batchDownloadListeners.delete(listener);
}

function getBatchDownloadSnapshot() {
    return batchDownloadSnapshots;
}

function getBatchDownloadLock(ownerKey: string): AsyncLock {
    let lock = batchDownloadLocks.get(ownerKey);
    if (!lock) {
        lock = new AsyncLock();
        batchDownloadLocks.set(ownerKey, lock);
    }
    return lock;
}

async function runBatchDownload(ownerKey: string, batchItems: ImageBatchDownloadItem[]) {
    const requestedOperationId = batchDownloadSnapshots.get(ownerKey)?.operationId ?? 0;
    if (batchDownloadSnapshots.get(ownerKey)?.busy || batchItems.length === 0) return;

    await getBatchDownloadLock(ownerKey).inLock(async () => {
        const currentSnapshot = batchDownloadSnapshots.get(ownerKey) ?? emptyBatchDownloadSnapshot;
        if (currentSnapshot.busy || currentSnapshot.operationId !== requestedOperationId) return;

        const operationId = ++nextOperationId;
        publishBatchDownloadSnapshot(ownerKey, {
            operationId,
            busy: true,
            progress: { completed: 0, total: batchItems.length },
            failedIds: [],
            summary: null,
        });

        try {
            const result = await downloadImageBatch(batchItems, {
                onProgress: ({ completed, total }) => {
                    const operationSnapshot = batchDownloadSnapshots.get(ownerKey);
                    if (
                        operationSnapshot?.operationId !== operationId
                        || !operationSnapshot.busy
                    ) return;
                    publishBatchDownloadSnapshot(ownerKey, {
                        ...operationSnapshot,
                        progress: { completed, total },
                    });
                },
            });
            const operationSnapshot = batchDownloadSnapshots.get(ownerKey);
            if (operationSnapshot?.operationId !== operationId) return;

            if (result.cancelled) {
                publishBatchDownloadSnapshot(ownerKey, {
                    ...operationSnapshot,
                    failedIds: [],
                    summary: {
                        succeeded: 0,
                        failed: 0,
                        cancelled: true,
                        destination: result.destination,
                    },
                });
                return;
            }

            publishBatchDownloadSnapshot(ownerKey, {
                ...operationSnapshot,
                failedIds: result.failed.map(({ id }) => id),
                summary: {
                    succeeded: result.succeeded.length,
                    failed: result.failed.length,
                    cancelled: false,
                    destination: result.destination,
                },
            });
        } finally {
            const operationSnapshot = batchDownloadSnapshots.get(ownerKey);
            if (operationSnapshot?.operationId === operationId) {
                publishBatchDownloadSnapshot(ownerKey, {
                    ...operationSnapshot,
                    busy: false,
                    progress: null,
                });
            }
        }
    });
}

// Owns batch progress outside the gallery lifecycle so downloads survive
// remounts while remaining isolated and exclusive per stable batch identity.
export function useGeneratedImageBatchDownload(items: ImageBatchDownloadItem[]) {
    const operations = React.useSyncExternalStore(
        subscribeBatchDownload,
        getBatchDownloadSnapshot,
        getBatchDownloadSnapshot,
    );
    const ownerKey = React.useMemo(() => JSON.stringify(items.map(({ id }) => id)), [items]);
    const numberedItems = React.useMemo(
        () => items.map((item, index) => ({ ...item, ordinal: item.ordinal ?? index + 1 })),
        [items],
    );
    const operation = operations.get(ownerKey) ?? emptyBatchDownloadSnapshot;
    const performDownload = React.useCallback(
        async (batchItems: ImageBatchDownloadItem[]) => runBatchDownload(ownerKey, batchItems),
        [ownerKey],
    );
    const [actionLoading, startDownload] = useHappyAction(performDownload);
    const failedItems = React.useMemo(() => {
        const failedIdSet = new Set(operation.failedIds);
        return numberedItems.filter((item) => failedIdSet.has(item.id));
    }, [numberedItems, operation.failedIds]);

    return {
        actionLoading,
        failedItems,
        numberedItems,
        operation,
        startDownload,
    };
}
