import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { BrowserStepsPanel } from './BrowserStepsPanel';
import type { BrowserStep } from './browserStepsModel';

export const BrowserStepsPopover = React.memo(function BrowserStepsPopover(props: {
    open: boolean; onClose: () => void; sessionId: string; steps: BrowserStep[];
}) {
    const { theme } = useUnistyles();
    React.useEffect(() => {
        if (!props.open || Platform.OS !== 'web' || typeof window === 'undefined') return;
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
        window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
    }, [props.onClose, props.open]);
    if (!props.open) return null;
    return (
        <View accessibilityViewIsModal style={styles.overlay} testID="browser-steps-popover">
            <Pressable accessibilityLabel="Close browser progress" onPress={props.onClose} style={styles.scrim} />
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.divider }]}>
                <View style={[styles.header, { borderBottomColor: theme.colors.divider }]}>
                    <Text style={[styles.title, { color: theme.colors.text }]}>浏览器执行过程</Text>
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={props.onClose}>
                        <Ionicons color={theme.colors.textSecondary} name="close" size={20} />
                    </Pressable>
                </View>
                <BrowserStepsPanel sessionId={props.sessionId} steps={props.steps} />
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    overlay: { ...StyleSheet.absoluteFillObject, zIndex: 50, alignItems: 'center', justifyContent: 'center', padding: 12 },
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' },
    card: { borderRadius: 14, borderWidth: 1, height: '82%', maxHeight: 720, maxWidth: 520, overflow: 'hidden', width: '100%' },
    header: { alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11 },
    title: { fontSize: 15, fontWeight: '700' },
}));
