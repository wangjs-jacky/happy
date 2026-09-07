import * as React from 'react';
import { ImageViewer } from './ImageViewer';
import type { ImageViewerSource } from '@/sync/imageViewer';
import { storage } from '@/sync/storage';
import { loadEarlierSessionImages } from '@/sync/loadEarlierSessionImages';
import { collectSessionImageGallery } from '@/sync/sessionImageGallery';
import { releaseImageViewerImageCache } from '@/hooks/useAttachmentImage';

/** Share history pagination between the root viewer and the browser-step modal. */
export function SessionImageViewer(props: {
    sources: ImageViewerSource[];
    initialIndex: number;
    onClose: () => void;
    active?: boolean;
}) {
    const sessionId = props.sources[0]?.sessionId;
    const hasEarlier = storage(state => sessionId ? !!state.sessionMessages[sessionId]?.hasMoreOlder : false);
    const messages = storage(state => sessionId ? state.sessionMessages[sessionId]?.messages : undefined);
    const earliestAvailableRef = React.useMemo(() => sessionId && messages
        ? collectSessionImageGallery(sessionId, messages)[0]?.attachmentRef
        : undefined, [sessionId, messages]);
    React.useEffect(() => () => releaseImageViewerImageCache(), []);
    return <ImageViewer {...props} hasEarlier={hasEarlier} earliestAvailableRef={earliestAvailableRef} loadEarlier={loadEarlierSessionImages} />;
}
