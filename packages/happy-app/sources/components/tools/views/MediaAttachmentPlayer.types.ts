export type MediaAttachmentPlayerProps = {
    uri: string;
    headers: Record<string, string>;
    title: string;
    kind: 'audio' | 'video';
    mimeType: string;
    testID: string;
    /** Private ownership-scoped identity for reusable Web streaming videos. */
    reuseKey?: string;
    isSourceCurrent?: () => boolean;
    refreshSource?: () => Promise<{ uri: string; headers: Record<string, string> }>;
    autoPlay?: boolean;
    posterUri?: string;
    aspectRatio?: number;
};
