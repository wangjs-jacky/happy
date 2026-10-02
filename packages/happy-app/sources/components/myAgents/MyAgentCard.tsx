import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import type { MyAgentCard as Card } from '@/utils/sessionMyAgentCard';

export function MyAgentCard({ card }: { card: Card }) {
    const router = useRouter();
    return <View style={styles.card}><Text style={styles.title}>{card.name}</Text>{card.summary ? <Text style={styles.summary}>{card.summary}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel={`开始使用 ${card.name}`} onPress={() => router.push(`/new?myAgentMode=use&myAgentId=${encodeURIComponent(card.id)}` as any)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.title}>开始使用 →</Text></Pressable></View>;
}
const styles = StyleSheet.create(theme => ({
    card: { marginVertical: 12, borderWidth: 1, borderColor: theme.colors.divider, borderRadius: 14, padding: 16, gap: 10, backgroundColor: theme.colors.surface },
    title: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    summary: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 },
    button: { minHeight: 44, padding: 12, borderRadius: 8, backgroundColor: theme.colors.surfaceSelected },
    pressed: { backgroundColor: theme.colors.surfacePressed },
}));
