import * as React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { t } from '@/text';
import { useHappyAction } from '@/hooks/useHappyAction';
import {
    downloadImageBatch,
    type ImageBatchDownloadDestination,
    type ImageBatchDownloadItem,
    type ImageBatchDownloadProgress,
} from '@/utils/imageBatchDownload';

export type GeneratedImageBatchDownloadProps = {
    items: ImageBatchDownloadItem[];
    displayedCount: number;
    settledCount: number;
    pendingCount: number;
};

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

let nextOperationId = 0;
const emptyBatchDownloadSnapshot: BatchDownloadSnapshot = {
    operationId: 0,
    busy: false,
    progress: null,
    failedIds: [],
    summary: null,
};
let batchDownloadSnapshots: ReadonlyMap<string, BatchDownloadSnapshot> = new Map();
const batchDownloadListeners = new Set<() => void>();

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

async function runBatchDownload(ownerKey: string, batchItems: ImageBatchDownloadItem[]) {
    const currentSnapshot = batchDownloadSnapshots.get(ownerKey);
    if (currentSnapshot?.busy || batchItems.length === 0) return;

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
}

export function GeneratedImageBatchDownload({
    items,
    displayedCount,
    settledCount,
    pendingCount,
}: GeneratedImageBatchDownloadProps) {
    const { theme } = useUnistyles();
    const busyRef = React.useRef(false);
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
    const progress = operation.progress;
    const failedIds = operation.failedIds;
    const summary = operation.summary;
    const totalCount = displayedCount + pendingCount;
    const isPreparing = pendingCount > 0 || settledCount < displayedCount;

    const performDownload = React.useCallback(async (batchItems: ImageBatchDownloadItem[]) => {
        if (busyRef.current || batchItems.length === 0) return;
        busyRef.current = true;
        try {
            await runBatchDownload(ownerKey, batchItems);
        } finally {
            busyRef.current = false;
        }
    }, [ownerKey]);
    const [actionLoading, startDownload] = useHappyAction(performDownload);

    const failedItems = React.useMemo(() => {
        const failedIdSet = new Set(failedIds);
        return numberedItems.filter((item) => failedIdSet.has(item.id));
    }, [failedIds, numberedItems]);
    const disabled = isPreparing || operation.busy || actionLoading || items.length === 0;
    const label = isPreparing
        ? t('generatedImageBatchDownload.preparing', { ready: settledCount, total: totalCount })
        : progress
            ? t('generatedImageBatchDownload.downloading', progress)
            : t('generatedImageBatchDownload.downloadAll', { count: items.length });

    if (totalCount <= 1) return null;

    const summaryText = summary?.cancelled
        ? summary.destination === 'directory'
            ? t('generatedImageBatchDownload.cancelledDirectory')
            : summary.destination === 'photos'
                ? t('generatedImageBatchDownload.cancelledPhotos')
                : summary.destination === 'browser'
                    ? t('generatedImageBatchDownload.cancelledBrowser')
                    : t('generatedImageBatchDownload.cancelledUnsupported')
        : summary?.failed
            ? t('generatedImageBatchDownload.partial', summary)
            : summary?.destination === 'browser'
                ? t('generatedImageBatchDownload.savedBrowser', { count: summary.succeeded })
                : summary?.destination === 'directory'
                    ? t('generatedImageBatchDownload.savedDirectory', { count: summary.succeeded })
                    : summary?.destination === 'photos'
                        ? t('generatedImageBatchDownload.savedPhotos', { count: summary.succeeded })
                        : summary
                            ? t('generatedImageBatchDownload.saved', { count: summary.succeeded })
                            : null;

    return (
        <View style={styles.container}>
            <Pressable
                testID="attachment-gallery-download-all"
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => startDownload(numberedItems)}
                style={({ pressed }) => [
                    styles.action,
                    {
                        backgroundColor: pressed
                            ? theme.colors.surfacePressed
                            : theme.colors.surface,
                        borderColor: theme.colors.divider,
                        opacity: disabled ? 0.55 : 1,
                    },
                ]}
            >
                {progress ? (
                    <ActivityIndicator
                        testID="attachment-gallery-download-progress"
                        size="small"
                        color={theme.colors.textSecondary}
                    />
                ) : (
                    <Ionicons
                        name="download-outline"
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                )}
                <Text style={[styles.actionText, { color: theme.colors.text }]}>{label}</Text>
            </Pressable>

            {summary ? (
                <View testID="attachment-gallery-download-summary" style={styles.summaryRow}>
                    <Text
                        testID={!summary.cancelled && summary.failed === 0 ? 'attachment-gallery-download-success' : undefined}
                        style={[styles.summaryText, { color: theme.colors.textSecondary }]}
                    >
                        {summaryText}
                    </Text>
                    {failedItems.length > 0 ? (
                        <Pressable
                            testID="attachment-gallery-download-retry"
                            accessibilityRole="button"
                            accessibilityState={{ disabled: progress !== null }}
                            disabled={progress !== null}
                            onPress={() => startDownload(failedItems)}
                            style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                        >
                            <Text style={[styles.retryText, { color: theme.colors.accent }]}>
                                {t('generatedImageBatchDownload.retryFailed', { count: failedItems.length })}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    container: {
        alignItems: 'flex-end',
        gap: 6,
    },
    action: {
        minHeight: 34,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 7,
    },
    actionText: {
        fontSize: 13,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
    },
    summaryText: {
        fontSize: 12,
        fontWeight: '500',
    },
    retryText: {
        fontSize: 12,
        fontWeight: '700',
    },
}));
