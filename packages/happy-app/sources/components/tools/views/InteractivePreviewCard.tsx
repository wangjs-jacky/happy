import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { interactivePreviewEventSchema } from '@slopus/happy-wire';
import { openExternalUrl } from '@/utils/openExternalUrl';
import type { ToolViewProps } from './_all';

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
    const ready = state === 'ready' && Boolean(preview.url);
    const label = state === 'publishing' ? '正在发布…' : state === 'ready' ? '在线预览已就绪' : state === 'expired' ? '预览已过期' : '发布失败';
    return (
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceHigh, borderColor: theme.colors.divider }]} testID="interactive-preview-card">
            <View style={styles.titleRow}>
                <View style={[styles.icon, { backgroundColor: theme.colors.surface }]}><Ionicons color={theme.colors.text} name="desktop-outline" size={18} /></View>
                <View style={styles.copy}><Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>{preview.title}</Text><Text style={[styles.status, { color: theme.colors.textSecondary }]}>{label}</Text></View>
            </View>
            {ready ? <View style={styles.actions}>
                <Pressable accessibilityRole="link" onPress={() => void openExternalUrl(preview.url!)} style={[styles.primary, { backgroundColor: theme.colors.button.primary.background }]}><Text style={[styles.primaryText, { color: theme.colors.button.primary.tint }]}>打开交互稿</Text><Ionicons color={theme.colors.button.primary.tint} name="open-outline" size={15} /></Pressable>
                <Pressable accessibilityRole="button" onPress={() => void Clipboard.setStringAsync(preview.url!)} style={[styles.secondary, { borderColor: theme.colors.divider }]}><Ionicons color={theme.colors.text} name="copy-outline" size={16} /></Pressable>
            </View> : null}
            {preview.expiresAt ? <Text style={[styles.expiry, { color: theme.colors.textSecondary }]}>链接将在 {new Date(preview.expiresAt).toLocaleString()} 失效</Text> : null}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    card: { borderRadius: 12, borderWidth: 1, gap: 12, padding: 14 },
    titleRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, icon: { alignItems: 'center', borderRadius: 9, height: 36, justifyContent: 'center', width: 36 }, copy: { flex: 1 },
    title: { fontSize: 15, fontWeight: '700' }, status: { fontSize: 12, marginTop: 2 }, actions: { flexDirection: 'row', gap: 8 },
    primary: { alignItems: 'center', borderRadius: 9, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: 9 }, primaryText: { fontSize: 13, fontWeight: '700' },
    secondary: { alignItems: 'center', borderRadius: 9, borderWidth: 1, justifyContent: 'center', width: 40 }, expiry: { fontSize: 11 },
}));
