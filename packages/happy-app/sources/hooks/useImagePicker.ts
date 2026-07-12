/**
 * Image picker hook for attaching images to messages.
 *
 * Wraps expo-image-picker with permission handling and thumbhash generation.
 * Enforces limits: max 50 images per message, 50MB per file.
 *
 * Note: fileSize from expo-image-picker is optional — some platforms do not
 * provide it (returns undefined → size=0). Such files pass the client-side
 * size check; the server enforces the limit on upload. Phase 5 should handle
 * 413 responses gracefully.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';
import { Modal } from '@/modal';
import { generateThumbhash } from '@/utils/thumbhash';
import { normalizeImageForUpload } from '@/utils/normalizeImageForUpload';
import { AttachmentSourceSheet } from '@/components/AttachmentSourceSheet';
import { t } from '@/text';
import type { AttachmentPreview, AttachmentKind } from '@/sync/attachmentTypes';

export const MAX_IMAGES_PER_MESSAGE = 50;
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — image lane
// Media currently reuses the encrypted transport (server-capped at 50MB). The
// 500MB plaintext-OSS lane is a future server+OSS upgrade.
export const MAX_MEDIA_FILE_SIZE = 50 * 1024 * 1024; // 50MB — audio/video lane

export type { AttachmentPreview };

type UseImagePickerResult = {
    selectedImages: AttachmentPreview[];
    pickImages: () => Promise<void>;
    /** Pick audio/video files via the system document picker (plaintext lane). */
    pickMedia: () => Promise<void>;
    /** Show a chooser (photo vs audio/video), then run the matching picker. */
    pickAttachment: () => void;
    removeImage: (id: string) => void;
    clearImages: () => void;
    addImages: (images: AttachmentPreview[]) => void;
};

/** Classify a document-picker asset's mimeType into our media kinds. */
function mediaKindFromMime(mimeType: string | undefined, name: string): AttachmentKind {
    const mime = (mimeType ?? '').toLowerCase();
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    const ext = (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
    if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
    return 'video';
}

export function useImagePicker(): UseImagePickerResult {
    const [selectedImages, setSelectedImages] = useState<AttachmentPreview[]>([]);
    // Ref tracks current count to avoid stale closures on rapid taps.
    const selectedCountRef = useRef(0);
    useEffect(() => {
        selectedCountRef.current = selectedImages.length;
    }, [selectedImages]);

    const requestPermission = useCallback(async (): Promise<boolean> => {
        if (Platform.OS === 'web') return true;

        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
            Modal.alert(
                t('imageUpload.permissionTitle'),
                t('imageUpload.permissionMessage'),
                [{ text: t('common.ok') }],
            );
            return false;
        }
        return true;
    }, []);

    const pickImages = useCallback(async () => {
        const hasPermission = await requestPermission();
        if (!hasPermission) return;

        const remaining = MAX_IMAGES_PER_MESSAGE - selectedCountRef.current;
        if (remaining <= 0) {
            Modal.alert(
                t('imageUpload.limitTitle'),
                t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
                [{ text: t('common.ok') }],
            );
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'], // expo-image-picker ~55: MediaTypeOptions deprecated
            allowsMultipleSelection: true,
            selectionLimit: remaining,
            quality: 1, // don't let the picker recompress — normalizeImageForUpload handles format
            exif: false,
        });

        if (result.canceled || !result.assets.length) return;

        // On web, selectionLimit is not enforced by the browser — clamp here.
        const assets = result.assets.slice(0, remaining);
        const previews: AttachmentPreview[] = [];
        // Images whose bytes couldn't be read or transcoded to a vision-readable
        // format. Surface these instead of silently dropping them, otherwise the
        // model later reports "no image" for an attachment the user clearly added.
        let unreadableCount = 0;

        for (const asset of assets) {
            if ((asset.fileSize ?? 0) > MAX_FILE_SIZE) {
                Modal.alert(
                    t('imageUpload.fileTooLargeTitle'),
                    t('imageUpload.fileTooLargeMessage', { name: asset.fileName ?? 'image', maxMb: 10 }),
                    [{ text: t('common.ok') }],
                );
                continue;
            }

            // Normalize to a format the vision models can decode (HEIC/HEIF → JPEG),
            // and read the true byte size (the picker often reports 0).
            let normalized;
            try {
                normalized = await normalizeImageForUpload(asset.uri, asset.width, asset.height);
            } catch {
                unreadableCount++;
                continue;
            }

            if (normalized.size > MAX_FILE_SIZE) {
                Modal.alert(
                    t('imageUpload.fileTooLargeTitle'),
                    t('imageUpload.fileTooLargeMessage', { name: asset.fileName ?? 'image', maxMb: 10 }),
                    [{ text: t('common.ok') }],
                );
                continue;
            }

            // Skip thumbhash if dimensions are unavailable (prevents divide-by-zero).
            const thumbhash = (normalized.width > 0 && normalized.height > 0)
                ? await generateThumbhash(normalized.uri, normalized.width, normalized.height)
                : undefined;

            previews.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                uri: normalized.uri,
                width: normalized.width,
                height: normalized.height,
                mimeType: normalized.mimeType,
                size: normalized.size,
                name: asset.fileName ?? `image_${Date.now()}.jpg`,
                thumbhash,
            });
        }

        if (unreadableCount > 0) {
            Modal.alert(
                t('imageUpload.normalizeFailedTitle'),
                t('imageUpload.normalizeFailedMessage', { count: unreadableCount }),
                [{ text: t('common.ok') }],
            );
        }

        if (previews.length > 0) {
            setSelectedImages(prev => [...prev, ...previews].slice(0, MAX_IMAGES_PER_MESSAGE));
        }
    }, [requestPermission]);

    const pickMedia = useCallback(async () => {
        const remaining = MAX_IMAGES_PER_MESSAGE - selectedCountRef.current;
        if (remaining <= 0) {
            Modal.alert(
                t('imageUpload.limitTitle'),
                t('imageUpload.limitMessage', { max: MAX_IMAGES_PER_MESSAGE }),
                [{ text: t('common.ok') }],
            );
            return;
        }

        // Audio isn't in the photo library and video needs its real container, so
        // media goes through the system document picker, not expo-image-picker.
        const result = await DocumentPicker.getDocumentAsync({
            type: ['audio/*', 'video/*'],
            multiple: true,
            copyToCacheDirectory: true, // stable file:// uri for streaming upload
        });
        if (result.canceled || !result.assets?.length) return;

        const assets = result.assets.slice(0, remaining);
        const previews: AttachmentPreview[] = [];
        for (const asset of assets) {
            const size = asset.size ?? 0;
            if (size > MAX_MEDIA_FILE_SIZE) {
                Modal.alert(
                    t('imageUpload.fileTooLargeTitle'),
                    t('imageUpload.fileTooLargeMessage', { name: asset.name ?? 'file', maxMb: MAX_MEDIA_FILE_SIZE / 1024 / 1024 }),
                    [{ text: t('common.ok') }],
                );
                continue;
            }
            const name = asset.name ?? `media_${Date.now()}`;
            previews.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
                uri: asset.uri,
                width: 0,
                height: 0,
                mimeType: asset.mimeType ?? 'application/octet-stream',
                size,
                name,
                kind: mediaKindFromMime(asset.mimeType, name),
            });
        }

        if (previews.length > 0) {
            setSelectedImages(prev => [...prev, ...previews].slice(0, MAX_IMAGES_PER_MESSAGE));
        }
    }, []);

    const pickAttachment = useCallback(() => {
        // Card-style source chooser (photo vs audio/video) instead of the plain
        // OS alert row — see AttachmentSourceSheet.
        Modal.show({
            component: AttachmentSourceSheet,
            props: {
                onPickPhoto: () => { void pickImages(); },
                onPickMedia: () => { void pickMedia(); },
            },
        });
    }, [pickImages, pickMedia]);

    const removeImage = useCallback((id: string) => {
        setSelectedImages(prev => prev.filter(img => img.id !== id));
    }, []);

    const clearImages = useCallback(() => {
        setSelectedImages([]);
    }, []);

    const addImages = useCallback((images: AttachmentPreview[]) => {
        setSelectedImages(prev => {
            const remaining = MAX_IMAGES_PER_MESSAGE - prev.length;
            if (remaining <= 0) return prev;
            return [...prev, ...images.slice(0, remaining)];
        });
    }, []);

    return { selectedImages, pickImages, pickMedia, pickAttachment, removeImage, clearImages, addImages };
}
