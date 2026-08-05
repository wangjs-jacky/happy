import * as React from 'react';
import { WebView } from 'react-native-webview';

export function MediaAttachmentPlayer(props: {
    uri: string;
    headers: Record<string, string>;
    title: string;
    kind: 'audio' | 'video';
}) {
    const height = props.kind === 'audio' ? 64 : 158;
    return (
        <WebView
            testID="media-attachment-player"
            source={{ uri: props.uri, headers: props.headers }}
            style={{ width: 280, height, backgroundColor: '#000' }}
            originWhitelist={['*']}
            allowsFullscreenVideo
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction
            accessibilityLabel={`播放 ${props.title}`}
        />
    );
}
