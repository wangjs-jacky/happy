import * as React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRelationshipAdvisorMessageImages } from '@/hooks/useRelationshipAdvisorMessageImages';
import { imageViewer } from '@/sync/imageViewer';
import type { AdvisorImageSource } from '@/sync/relationshipAdvisorImageEvents';
import { t } from '@/text';

export function RelationshipAdvisorMessageImages({ imageKeys, imageCount }: { imageKeys?: string[]; imageCount: number }) {
    const { theme } = useUnistyles();
    const { sources, loading } = useRelationshipAdvisorMessageImages(imageKeys);
    const available = sources.filter((source): source is AdvisorImageSource => source !== null);
    if (imageCount === 0) return null;
    return (
        <View style={styles.images} testID="relationship-advisor-message-images">
            {available.map((source, index) => (
                <Pressable
                    key={source.uri}
                    accessibilityRole="button"
                    accessibilityLabel={t('generatedImages.openImage')}
                    testID="relationship-advisor-image"
                    onPress={() => imageViewer.open(available.map(({ uri }) => ({ uri })), index)}
                    style={({ pressed }) => [styles.thumbnail, pressed && styles.pressed]}
                >
                    <Image source={{ uri: source.uri }} contentFit="cover"
                        style={{ width: 100, height: 100, borderRadius: 10 }} />
                </Pressable>
            ))}
            {loading ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : null}
            {!loading && available.length < imageCount ? (
                <View style={styles.unavailable}>
                    <Ionicons name="image-outline" size={18} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{t('imageUpload.mediaLoadFailed')}</Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    images: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
    thumbnail: { width: 102, height: 102, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.divider, backgroundColor: theme.colors.surface, overflow: 'hidden' },
    pressed: { backgroundColor: theme.colors.surfacePressed, opacity: 0.8 },
    unavailable: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
}));
