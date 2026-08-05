import * as React from 'react';
import { View } from 'react-native';

export function MediaAttachmentPlayer(props: {
    uri: string;
    headers: Record<string, string>;
    title: string;
    kind: 'audio' | 'video';
}) {
    const [source, setSource] = React.useState(props.uri);

    React.useEffect(() => {
        const hasHeaders = Object.keys(props.headers).length > 0;
        if (!hasHeaders) {
            setSource(props.uri);
            return;
        }

        let cancelled = false;
        let objectUrl: string | null = null;
        void fetch(props.uri, { headers: props.headers })
            .then((response) => {
                if (!response.ok) throw new Error(`media download failed: ${response.status}`);
                return response.blob();
            })
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setSource(objectUrl);
            })
            .catch(() => {
                if (!cancelled) setSource(props.uri);
            });

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [props.headers, props.uri]);

    return (
        <View testID="media-attachment-player" style={{ width: 280, height: props.kind === 'audio' ? 54 : 158, backgroundColor: '#000' }}>
            {React.createElement(props.kind === 'audio' ? 'audio' : 'video', {
                src: source,
                controls: true,
                playsInline: true,
                title: props.title,
                style: { width: '100%', height: '100%', backgroundColor: '#000' },
            })}
        </View>
    );
}
