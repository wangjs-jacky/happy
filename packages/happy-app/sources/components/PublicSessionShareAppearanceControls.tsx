import * as React from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native-unistyles';
import type { PublicSessionCover, PublicSessionThemePack } from '@slopus/happy-wire';
import { MAX_FILE_SIZE, useImagePicker } from '@/hooks/useImagePicker';
import { getRandomPublicSessionCover, type PublicSessionCoverCandidate } from '@/sync/apiPublicSessionShares';
import type { PublicSessionCoverSelection } from '@/sync/publicSessionShareQueue';
import { useLocalSettingMutable } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { ACCENTS } from '@/themePacksData';
import { t } from '@/text';

type ExistingCover = PublicSessionCover & { uri: string };

export interface PublicSessionShareAppearanceControlsProps {
    sessionId: string;
    themePack: PublicSessionThemePack;
    coverSelection?: PublicSessionCoverSelection;
    existingCover?: ExistingCover;
    disabled?: boolean;
    onThemePackChange: (themePack: PublicSessionThemePack) => void;
    onCoverSelectionChange: (coverSelection: PublicSessionCoverSelection | undefined) => void;
}

export const PublicSessionShareAppearanceControls = React.memo(function PublicSessionShareAppearanceControls({
    sessionId,
    themePack,
    coverSelection,
    existingCover,
    disabled = false,
    onThemePackChange,
    onCoverSelectionChange,
}: PublicSessionShareAppearanceControlsProps) {
    const [, setLastPublicShareThemePack] = useLocalSettingMutable('lastPublicShareThemePack');
    const { selectedImages, pickImages, clearImages } = useImagePicker({
        maxAttachments: 1,
        maxImageSizeBytes: MAX_FILE_SIZE,
    });
    const [candidate, setCandidate] = React.useState<PublicSessionCoverCandidate | null>(null);
    const [providerUnavailable, setProviderUnavailable] = React.useState(false);
    const [randomLoading, setRandomLoading] = React.useState(false);
    const [existingRemoved, setExistingRemoved] = React.useState(false);
    const requestSequence = React.useRef(0);
    const randomLoadingRef = React.useRef(false);
    const processedUploadId = React.useRef<string | null>(null);

    React.useEffect(() => () => {
        requestSequence.current += 1;
    }, []);

    React.useEffect(() => {
        const image = selectedImages[0];
        if (!image || processedUploadId.current === image.id) return;
        processedUploadId.current = image.id;
        requestSequence.current += 1;
        setCandidate(null);
        setProviderUnavailable(false);
        setExistingRemoved(true);
        onCoverSelectionChange({
            kind: 'upload',
            attachmentId: randomUUID(),
            uri: image.uri,
            name: image.name,
            mimeType: image.mimeType,
            size: image.size,
            width: image.width,
            height: image.height,
            ...(image.thumbhash ? { thumbhash: image.thumbhash } : {}),
        });
    }, [onCoverSelectionChange, selectedImages]);

    const selectThemePack = React.useCallback((nextThemePack: PublicSessionThemePack) => {
        setLastPublicShareThemePack(nextThemePack);
        onThemePackChange(nextThemePack);
    }, [onThemePackChange, setLastPublicShareThemePack]);

    const selectRandomCover = React.useCallback(async () => {
        if (disabled || randomLoadingRef.current) return;
        const credentials = sync.getCredentials();
        if (!credentials) {
            setProviderUnavailable(true);
            return;
        }
        const sequence = requestSequence.current + 1;
        requestSequence.current = sequence;
        randomLoadingRef.current = true;
        setRandomLoading(true);
        setProviderUnavailable(false);
        try {
            const nextCandidate = await getRandomPublicSessionCover(credentials, sessionId);
            if (requestSequence.current !== sequence) return;
            clearImages();
            processedUploadId.current = null;
            setExistingRemoved(true);
            setCandidate(nextCandidate);
            onCoverSelectionChange({ kind: 'pexels', photoId: nextCandidate.photoId });
        } catch {
            if (requestSequence.current === sequence) setProviderUnavailable(true);
        } finally {
            if (requestSequence.current === sequence) {
                randomLoadingRef.current = false;
                setRandomLoading(false);
            }
        }
    }, [clearImages, disabled, onCoverSelectionChange, sessionId]);

    const selectUploadCover = React.useCallback(() => {
        if (disabled) return;
        requestSequence.current += 1;
        randomLoadingRef.current = false;
        setRandomLoading(false);
        clearImages();
        processedUploadId.current = null;
        void pickImages();
    }, [clearImages, disabled, pickImages]);

    const removeCover = React.useCallback(() => {
        if (disabled) return;
        requestSequence.current += 1;
        randomLoadingRef.current = false;
        setRandomLoading(false);
        clearImages();
        processedUploadId.current = null;
        setCandidate(null);
        setProviderUnavailable(false);
        setExistingRemoved(true);
        onCoverSelectionChange(undefined);
    }, [clearImages, disabled, onCoverSelectionChange]);

    const uploadPreview = selectedImages[0];
    const selectedUploadUri = coverSelection?.kind === 'upload' ? coverSelection.uri : undefined;
    const existingPreview = !existingRemoved ? existingCover : undefined;
    const previewUri = candidate?.previewUrl ?? uploadPreview?.uri ?? selectedUploadUri ?? existingPreview?.uri;
    const attribution = candidate?.attribution ?? existingPreview?.attribution;
    const hasCover = Boolean(previewUri || coverSelection);

    return (
        <View accessibilityLabel={t('sessionShare.appearance')} style={styles.container} testID="public-share-appearance-controls">
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('sessionShare.themeColor')}</Text>
                <View accessibilityRole="radiogroup" style={styles.swatchRow}>
                    {ACCENTS.map((accent) => {
                        const selected = accent.id === themePack;
                        return (
                            <Pressable
                                accessibilityLabel={t('sessionShare.themeColorOption', { theme: accent.id })}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected, disabled }}
                                disabled={disabled}
                                key={accent.id}
                                onPress={() => selectThemePack(accent.id as PublicSessionThemePack)}
                                style={({ pressed }) => [
                                    styles.swatchButton,
                                    selected && styles.swatchButtonSelected,
                                    pressed && styles.swatchButtonPressed,
                                    disabled && styles.disabled,
                                ]}
                                testID={`public-share-theme-${accent.id}`}
                            >
                                <View style={[styles.swatch, { backgroundColor: accent.swatch.primary }]}>
                                    {selected ? (
                                        <Ionicons color={accent.light.onPrimary} name="checkmark" size={15} />
                                    ) : null}
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('sessionShare.cover')}</Text>
                {previewUri ? (
                    <View style={styles.previewWrap}>
                        <Image
                            accessibilityLabel={t('sessionShare.coverPreview')}
                            contentFit="cover"
                            source={{ uri: previewUri }}
                            style={styles.preview}
                            testID="public-share-cover-preview"
                        />
                        {attribution ? (
                            <Pressable
                                accessibilityLabel={t('sessionShare.coverAttribution', {
                                    photographer: attribution.photographer,
                                })}
                                accessibilityRole="link"
                                onPress={() => void Linking.openURL(attribution.photoUrl)}
                                style={({ pressed }) => [styles.attributionLink, pressed && styles.attributionLinkPressed]}
                            >
                                <Text style={styles.attributionText} testID="public-share-cover-attribution">
                                    {t('sessionShare.coverAttribution', { photographer: attribution.photographer })}
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                ) : (
                    <View accessibilityLabel={t('sessionShare.noCover')} style={styles.emptyCover} testID="public-share-cover-empty">
                        <Ionicons color={styles.emptyCoverIcon.color} name="image-outline" size={20} />
                        <Text style={styles.emptyCoverText}>{t('sessionShare.noCover')}</Text>
                    </View>
                )}
                {providerUnavailable ? (
                    <Text accessibilityRole="alert" style={styles.providerState} testID="public-share-cover-provider-state">
                        {t('sessionShare.coverProviderUnavailable')}
                    </Text>
                ) : null}
                <View style={styles.coverActions}>
                    <CoverAction
                        disabled={disabled || randomLoading}
                        icon="shuffle-outline"
                        label={t('sessionShare.randomCover')}
                        loading={randomLoading}
                        onPress={selectRandomCover}
                        testID="public-share-cover-random"
                    />
                    <CoverAction
                        disabled={disabled}
                        icon="cloud-upload-outline"
                        label={t('sessionShare.uploadCover')}
                        onPress={selectUploadCover}
                        testID="public-share-cover-upload"
                    />
                    <CoverAction
                        disabled={disabled || !hasCover}
                        icon="trash-outline"
                        label={t('sessionShare.removeCover')}
                        onPress={removeCover}
                        testID="public-share-cover-remove"
                    />
                </View>
            </View>
        </View>
    );
});

function CoverAction({
    disabled,
    icon,
    label,
    loading = false,
    onPress,
    testID,
}: {
    disabled: boolean;
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    loading?: boolean;
    onPress: () => void | Promise<void>;
    testID: string;
}) {
    return (
        <Pressable
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ busy: loading, disabled }}
            disabled={disabled}
            onPress={onPress}
            style={({ pressed }) => [styles.coverAction, pressed && styles.coverActionPressed, disabled && styles.disabled]}
            testID={testID}
        >
            {loading ? (
                <ActivityIndicator color={styles.coverActionIcon.color} size="small" />
            ) : (
                <Ionicons color={styles.coverActionIcon.color} name={icon} size={16} />
            )}
            <Text numberOfLines={1} style={styles.coverActionText}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: { gap: 16 },
    section: { gap: 10 },
    sectionTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '600' as const },
    swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    swatchButton: {
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 11,
        backgroundColor: theme.colors.surfaceHigh,
    },
    swatchButtonSelected: { backgroundColor: theme.colors.surfaceSelected },
    swatchButtonPressed: { backgroundColor: theme.colors.surfacePressed },
    swatch: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
    previewWrap: { gap: 7 },
    preview: { width: '100%', aspectRatio: 16 / 7, borderRadius: 11, backgroundColor: theme.colors.surfaceHigh },
    attributionLink: { alignSelf: 'flex-start', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 3 },
    attributionLinkPressed: { backgroundColor: theme.colors.surfacePressed },
    attributionText: { color: theme.colors.textSecondary, fontSize: 11 },
    emptyCover: {
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 11,
        backgroundColor: theme.colors.surfaceHigh,
    },
    emptyCoverIcon: { color: theme.colors.textSecondary },
    emptyCoverText: { color: theme.colors.textSecondary, fontSize: 12 },
    providerState: { color: theme.colors.status.error, fontSize: 12 },
    coverActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    coverAction: {
        minHeight: 38,
        flexGrow: 1,
        flexBasis: 120,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 10,
        borderRadius: 9,
        backgroundColor: theme.colors.surfaceHigh,
    },
    coverActionPressed: { backgroundColor: theme.colors.surfacePressed },
    coverActionIcon: { color: theme.colors.accent },
    coverActionText: { color: theme.colors.text, fontSize: 12, fontWeight: '500' as const },
    disabled: { opacity: 0.45 },
}));
