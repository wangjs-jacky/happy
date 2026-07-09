import * as React from 'react';
import { View, Pressable, ScrollView, Text } from 'react-native';
import { Image } from 'expo-image';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ScreenshotResponse } from '@slopus/happy-wire';
import { t } from '@/text';

interface DesktopScreenshotPreviewProps {
  screenshot: ScreenshotResponse;
  onClose: () => void;
}

/**
 * Fullscreen modal component for viewing a captured desktop screenshot.
 *
 * Displays the base64-encoded image from CLI screenshot capture,
 * with a close button and footer showing file size metadata.
 */
export function DesktopScreenshotPreview({
  screenshot,
  onClose,
}: DesktopScreenshotPreviewProps) {
  const { theme } = useUnistyles();
  const styles = stylesheet();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.closeButton} onPress={onClose}>
          <Octicons name="x" size={24} color={theme.colors.text} />
        </Pressable>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Image
          source={{ uri: `data:${screenshot.mimeType};base64,${screenshot.data}` }}
          style={styles.image}
          contentFit="contain"
        />
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {t('components.desktopScreenshot.size', {
            size: (screenshot.size / 1024).toFixed(1),
          })}
        </Text>
      </View>
    </View>
  );
}

const stylesheet = () => {
  const { theme } = useUnistyles();

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface,
    },
    header: {
      paddingHorizontal: theme.margins.md,
      paddingVertical: theme.margins.sm,
      justifyContent: 'center',
      alignItems: 'flex-end',
    },
    closeButton: {
      padding: theme.margins.sm,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.margins.md,
    },
    image: {
      width: '100%',
      borderRadius: 8,
      aspectRatio: 1,
    },
    footer: {
      paddingHorizontal: theme.margins.md,
      paddingVertical: theme.margins.sm,
      borderTopWidth: 1,
      borderTopColor: theme.colors.divider,
      justifyContent: 'center',
      alignItems: 'center',
    },
    footerText: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
  });
};
