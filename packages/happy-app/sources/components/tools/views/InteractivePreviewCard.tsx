import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { interactivePreviewEventSchema } from '@slopus/happy-wire';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { t } from '@/text';
import type { ToolViewProps } from './_all';

function safePreviewUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
    } catch {
        return null;
    }
}

export const InteractivePreviewCard = React.memo(function InteractivePreviewCard({ tool }: ToolViewProps) {
    const { theme } = useUnistyles();
    const parsed = interactivePreviewEventSchema.safeParse(tool.input);
    const expiresAt = parsed.success ? parsed.data.expiresAt : undefined;
    const [now, setNow] = React.useState(Date.now());
    React.useEffect(() => {
        if (!expiresAt || expiresAt <= now) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(expiresAt - now + 50, 2_147_483_647));
        return () => clearTimeout(timer);
    }, [expiresAt, now]);
    if (!parsed.success) return null;
    const preview = parsed.data;
    const state = preview.expiresAt && preview.expiresAt <= now ? 'expired' : preview.state;
    const url = state === 'ready' ? safePreviewUrl(preview.url) : null;
    const ready = Boolean(url);
    const label = state === 'publishing'
        ? t('interactivePreviews.publishing')
        : state === 'ready' && url
            ? t('interactivePreviews.ready')
            : state === 'expired'
                ? t('interactivePreviews.expired')
                : t('interactivePreviews.failed');
    return (
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]} testID="interactive-preview-card">
            <View style={styles.titleRow}>
                <View style={[styles.icon, { backgroundColor: theme.colors.surface }]}><Ionicons color={theme.colors.text} name="desktop-outline" size={18} /></View>
                <View style={styles.copy}>
                    <Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>{preview.title}</Text>
                    <Text style={[styles.provider, { color: theme.colors.textSecondary }]}>{t('interactivePreviews.provider')}</Text>
                    <Text style={[styles.status, { color: theme.colors.textSecondary }]}>{label}</Text>
                </View>
            </View>
            {ready ? <View style={styles.actions}>
                <Pressable
                    accessibilityLabel={t('interactivePreviews.open')}
                    accessibilityRole="link"
                    onPress={() => void openExternalUrl(url!)}
                    style={({ pressed }) => [styles.primary, {
                        backgroundColor: theme.colors.button.primary.background,
                        opacity: pressed ? 0.86 : 1,
                        transform: [{ scale: pressed ? 0.99 : 1 }],
                    }]}
                    testID="interactive-preview-open"
                ><Text style={[styles.primaryText, { color: theme.colors.button.primary.tint }]}>{t('interactivePreviews.open')}</Text><Ionicons color={theme.colors.button.primary.tint} name="open-outline" size={15} /></Pressable>
                <Pressable
                    accessibilityLabel={t('interactivePreviews.copy')}
                    accessibilityRole="button"
                    onPress={() => void Clipboard.setStringAsync(url!)}
                    style={({ pressed }) => [styles.secondary, { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceHigh, borderColor: theme.colors.divider }]}
                    testID="interactive-preview-copy"
                ><Ionicons color={theme.colors.text} name="copy-outline" size={16} /></Pressable>
            </View> : null}
            {preview.expiresAt ? <Text style={[styles.expiry, { color: theme.colors.textSecondary }]}>{t('interactivePreviews.expiresAt')} {new Date(preview.expiresAt).toLocaleString()}</Text> : null}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    card: { borderRadius: 12, borderWidth: 1, gap: 12, padding: 14 },
    titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, icon: { alignItems: 'center', borderRadius: 9, height: 36, justifyContent: 'center', width: 36 }, copy: { flex: 1 },
    title: { fontSize: 15, fontWeight: '700' }, provider: { fontSize: 11, marginTop: 1 }, status: { fontSize: 12, marginTop: 2 }, actions: { flexDirection: 'row', gap: 8 },
    primary: { alignItems: 'center', borderRadius: 9, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12, paddingVertical: 9 }, primaryText: { fontSize: 13, fontWeight: '700' },
    secondary: { alignItems: 'center', borderRadius: 9, borderWidth: 1, justifyContent: 'center', minHeight: 44, minWidth: 44 }, expiry: { fontSize: 11 },
}));
