/**
 * View for image and generated media `file` events.
 * Images keep the encrypted blob + thumbhash flow; plaintext audio/video uses
 * a compact card and resolves a short-lived playback source only on demand.
 *
 * Images render inline when a ref is present — if dimensions are missing
 * (older messages, iOS picker that didn't report w/h), a default 4:3 aspect
 * ratio is used until the actual image lands and contentFit shows it.
 */
import * as React from 'react';
import { ActivityIndicator, View, Text, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ToolViewProps } from './_all';
import { z } from 'zod';
import { useAttachmentImage } from '@/hooks/useAttachmentImage';
import { thumbhashToDataUri } from '@/utils/thumbhash';
import { imageViewer } from '@/sync/imageViewer';
import { requestAttachmentDownloadSource, type AttachmentDownloadSource } from '@/sync/apiAttachments';
import { sync } from '@/sync/sync';
import { MediaAttachmentPlayer } from './MediaAttachmentPlayer';

const fileInputSchema = z.object({
    ref: z.string(),
    name: z.string(),
    size: z.number().optional(),
    kind: z.enum(['image', 'audio', 'video']).optional(),
    mimeType: z.string().optional(),
    encrypted: z.boolean().optional(),
    image: z.object({
        width: z.number(),
        height: z.number(),
        thumbhash: z.string().optional(),
    }).optional(),
});

const BORDER_RADIUS = 8;
const MAX_IMAGE_WIDTH = 280;
const MAX_IMAGE_HEIGHT = 360;
const DEFAULT_ASPECT = 4 / 3; // when wire-format omits image{} dimensions

function humanSize(bytes: number | undefined): string | null {
    if (!bytes || bytes <= 0) return null;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${bytes}B`;
}

export const FileView = React.memo<ToolViewProps>(({ tool, sessionId }) => {
    const parsed = fileInputSchema.safeParse(tool.input);
    if (!parsed.success) return null;
    // Audio/video have no visual thumbnail — render a compact card (icon +
    // filename + size) instead of trying to load the blob as an image.
    if (parsed.data.kind === 'audio' || parsed.data.kind === 'video') {
        return (
            <MediaFileCard
                ref_={parsed.data.ref}
                sessionId={sessionId}
                name={parsed.data.name}
                kind={parsed.data.kind}
                size={parsed.data.size}
                encrypted={parsed.data.encrypted}
            />
        );
    }
    return <ImageFileView name={parsed.data.name} image={parsed.data.image} ref_={parsed.data.ref} sessionId={sessionId} />;
});

function MediaFileCard({ ref_, sessionId, name, kind, size, encrypted }: {
    ref_: string;
    sessionId?: string;
    name: string;
    kind: 'audio' | 'video';
    size?: number;
    encrypted?: boolean;
}) {
    const { theme } = useUnistyles();
    const sizeLabel = humanSize(size);
    const [source, setSource] = React.useState<AttachmentDownloadSource | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const handleOpen = React.useCallback(async () => {
        if (source) {
            setSource(null);
            return;
        }
        if (!sessionId || encrypted !== false) return;
        const credentials = sync.getCredentials();
        if (!credentials) {
            setError('登录信息不可用');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setSource(await requestAttachmentDownloadSource(credentials, sessionId, ref_));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    }, [encrypted, ref_, sessionId, source]);

    const playable = encrypted === false && !!sessionId;
    return (
        <View style={styles.inlineContainer}>
            <Pressable
                testID="media-attachment-card"
                accessibilityRole={playable ? 'button' : undefined}
                accessibilityLabel={playable ? `播放${kind === 'audio' ? '音频' : '视频'} ${name}` : name}
                onPress={playable ? handleOpen : undefined}
                disabled={!playable || loading}
                style={[styles.mediaCard, { borderColor: theme.colors.divider, backgroundColor: theme.colors.surfaceHigh }]}
            >
                <Ionicons name={kind === 'audio' ? 'musical-notes' : 'videocam'} size={20} color={theme.colors.text} />
                <View style={styles.mediaMeta}>
                    <Text style={[styles.filename, { color: theme.colors.text }]} numberOfLines={1}>{name}</Text>
                    <Text style={[styles.mediaSub, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                        {kind === 'audio' ? '音频' : '视频'}{sizeLabel ? ` · ${sizeLabel}` : ''}{playable ? source ? ' · 点击收起' : ' · 点击播放' : ''}
                    </Text>
                </View>
                {loading
                    ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    : playable
                        ? <Ionicons name={source ? 'chevron-up' : 'play-circle'} size={22} color={theme.colors.textSecondary} />
                        : null}
            </Pressable>
            {source ? (
                <View style={[styles.playerFrame, { height: kind === 'audio' ? 64 : 158 }]}>
                    <MediaAttachmentPlayer uri={source.uri} headers={source.headers} title={name} kind={kind} />
                </View>
            ) : null}
            {error ? <Text style={[styles.mediaError, { color: theme.colors.textDestructive }]}>{error}</Text> : null}
        </View>
    );
}

function ImageFileView({ name, image, ref_, sessionId }: {
    name: string;
    image?: { width: number; height: number; thumbhash?: string };
    ref_: string;
    sessionId?: string;
}) {
    const { theme } = useUnistyles();
    const ref = ref_;

    const placeholder = React.useMemo(() => {
        if (!image?.thumbhash) return undefined;
        const uri = thumbhashToDataUri(image.thumbhash);
        return uri ? { uri } : undefined;
    }, [image?.thumbhash]);

    const { uri, error } = useAttachmentImage(sessionId ?? '', sessionId ? ref : undefined);

    // Pick display dimensions. Real w/h drives the aspect ratio when present,
    // but a missing image{} block (older messages, iOS picker that didn't
    // report dimensions) shouldn't downgrade to a compact filename row —
    // the user attached an image, render it inline. Default to 4:3 at the
    // bubble's max width; expo-image's contentFit="cover" handles the
    // mismatch once the real image arrives.
    const aspect = image && image.width > 0 && image.height > 0
        ? image.width / image.height
        : DEFAULT_ASPECT;
    let displayW = Math.min(image?.width && image.width > 0 ? image.width : MAX_IMAGE_WIDTH, MAX_IMAGE_WIDTH);
    let displayH = displayW / aspect;
    if (displayH > MAX_IMAGE_HEIGHT) {
        displayH = MAX_IMAGE_HEIGHT;
        displayW = displayH * aspect;
    }

    return (
        <View style={styles.inlineContainer}>
            <Pressable
                onPress={uri ? () => imageViewer.open({ uri, width: image?.width, height: image?.height, filename: name }) : undefined}
                disabled={!uri}
                style={[styles.inlineWrapper, { borderColor: theme.colors.divider }]}
            >
                <Image
                    source={uri ? { uri } : undefined}
                    placeholder={placeholder}
                    style={[{ width: displayW, height: displayH }, styles.inlineImage]}
                    contentFit="cover"
                    transition={150}
                />
                {error && !uri && (
                    <View style={[styles.errorOverlay, { backgroundColor: theme.colors.surfaceHigh }]}>
                        <Ionicons name="alert-circle-outline" size={20} color={theme.colors.textSecondary} />
                    </View>
                )}
            </Pressable>
            <Text style={[styles.filename, { color: theme.colors.textSecondary }]} numberOfLines={1}>{name}</Text>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    inlineContainer: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 4,
    },
    inlineWrapper: {
        borderRadius: BORDER_RADIUS,
        borderWidth: 1,
        overflow: 'hidden',
        alignSelf: 'flex-start',
        position: 'relative',
    },
    inlineImage: {
        borderRadius: BORDER_RADIUS,
    },
    errorOverlay: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    filename: {
        fontSize: 13,
        fontWeight: '500',
    },
    mediaCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderWidth: 1,
        borderRadius: BORDER_RADIUS,
        paddingHorizontal: 12,
        paddingVertical: 10,
        alignSelf: 'flex-start',
        maxWidth: 260,
    },
    playerFrame: {
        width: 280,
        overflow: 'hidden',
        borderRadius: BORDER_RADIUS,
        backgroundColor: '#000',
    },
    mediaMeta: {
        flexShrink: 1,
    },
    mediaSub: {
        fontSize: 11,
        marginTop: 1,
    },
    mediaError: {
        maxWidth: 280,
        fontSize: 11,
    },
}));
