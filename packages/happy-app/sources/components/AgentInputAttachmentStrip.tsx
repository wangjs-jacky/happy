/**
 * Horizontal scrollable strip showing selected image attachment thumbnails.
 * Each thumbnail shows the image with a remove button.
 * Uses thumbhash as a blurry placeholder while the full image loads.
 */
import * as React from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AttachmentPreview } from '@/sync/attachmentTypes';
import { thumbhashToDataUri } from '@/utils/thumbhash';
import { imageViewer } from '@/sync/imageViewer';

const THUMB_SIZE = 72;
const BORDER_RADIUS = 12;

interface AgentInputAttachmentStripProps {
    images: AttachmentPreview[];
    onRemove: (id: string) => void;
}

export function AgentInputAttachmentStrip({ images, onRemove }: AgentInputAttachmentStripProps) {
    const { theme } = useUnistyles();

    if (images.length === 0) return null;

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.strip}
            contentContainerStyle={styles.stripContent}
            keyboardShouldPersistTaps="always"
        >
            {images.map((img) => (
                <AttachmentThumbnail
                    key={img.id}
                    image={img}
                    onRemove={onRemove}
                    theme={theme}
                />
            ))}
        </ScrollView>
    );
}

function AttachmentThumbnail({
    image,
    onRemove,
    theme,
}: {
    image: AttachmentPreview;
    onRemove: (id: string) => void;
    theme: any;
}) {
    // Build placeholder from thumbhash if available
    const placeholder = React.useMemo(() => {
        if (!image.thumbhash) return undefined;
        const uri = thumbhashToDataUri(image.thumbhash);
        return uri ? { uri } : undefined;
    }, [image.thumbhash]);

    return (
        <View style={styles.thumbContainer}>
            {/* Tap the image to open the fullscreen zoomable viewer. */}
            <Pressable
                onPress={() => imageViewer.open({ uri: image.uri, width: image.width, height: image.height })}
                style={[styles.thumbPressable, { borderColor: theme.colors.divider }]}
            >
                <Image
                    source={{ uri: image.uri }}
                    placeholder={placeholder}
                    style={[{ width: THUMB_SIZE, height: THUMB_SIZE }, styles.thumb]}
                    contentFit="cover"
                    transition={150}
                />
            </Pressable>
            {/* Remove button — sits above the image so its tap doesn't open the viewer. */}
            <Pressable
                onPress={() => onRemove(image.id)}
                hitSlop={6}
                style={(p) => [
                    styles.removeButton,
                    {
                        backgroundColor: theme.colors.surfaceHigh,
                        borderColor: theme.colors.divider,
                        opacity: p.pressed ? 0.7 : 1,
                    },
                ]}
            >
                <Ionicons name="close" size={12} color={theme.colors.text} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    strip: {
        marginBottom: 8,
        marginHorizontal: 8,
    },
    stripContent: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 4,
    },
    thumbContainer: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        overflow: 'visible',
        position: 'relative',
    },
    thumbPressable: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: BORDER_RADIUS,
        borderWidth: 1,
        overflow: 'hidden',
    },
    thumb: {
        borderRadius: BORDER_RADIUS,
    },
    removeButton: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
}));
