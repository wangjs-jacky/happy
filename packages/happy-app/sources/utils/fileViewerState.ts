export type FileViewerDisplayMode = 'file' | 'diff';

export function getInitialFileViewerDisplayMode(
    hasCachedDiff: boolean,
    requestedLine: number | null,
): FileViewerDisplayMode {
    if (requestedLine !== null && requestedLine > 0) {
        return 'file';
    }
    return hasCachedDiff ? 'diff' : 'file';
}

export function getEffectiveFileViewerDisplayMode(
    displayMode: FileViewerDisplayMode,
    hasDiffContent: boolean,
    hasFileContent: boolean,
): FileViewerDisplayMode {
    if (displayMode === 'diff' && !hasDiffContent && hasFileContent) {
        return 'file';
    }
    return displayMode;
}
