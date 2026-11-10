import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

export type PanelTab = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap };

/** Shared panel navigation, including keyboard selection and focus on Web. */
export function PanelTabs({ activeTab, tabs, onTabChange, testIDPrefix }: {
    activeTab: string; tabs: readonly PanelTab[]; onTabChange: (key: string) => void; testIDPrefix: string;
}) {
    const { theme } = useUnistyles();
    const refs = React.useRef(new Map<string, View>());
    return <View accessibilityRole="tablist" style={styles.tabs}>
        {tabs.map((tab, index) => {
            const selected = tab.key === activeTab;
            return <Pressable key={tab.key} ref={(node) => { if (node) refs.current.set(tab.key, node); else refs.current.delete(tab.key); }}
                accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
                nativeID={`${testIDPrefix}-${tab.key}-tab`} testID={`${testIDPrefix}-${tab.key}-tab`}
                onPress={() => onTabChange(tab.key)}
                {...(Platform.OS === 'web' ? {
                    tabIndex: selected ? 0 : -1,
                    'aria-selected': selected,
                    dataSet: { happyMotion: 'desktop-tab', happyMotionState: selected ? 'selected' : 'idle' },
                    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                                : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
                        if (nextIndex === null) return;
                        event.preventDefault();
                        onTabChange(tabs[nextIndex].key);
                        refs.current.get(tabs[nextIndex].key)?.focus();
                    },
                } : {})}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.tab, selected ? styles.selected : (pressed || hovered) ? styles.pressed : null]}>
                <Ionicons name={tab.icon} size={15} color={selected ? theme.colors.text : theme.colors.textSecondary} />
                <Text numberOfLines={1} style={[styles.text, selected && styles.selectedText]}>{tab.label}</Text>
            </Pressable>;
        })}
    </View>;
}
const styles = StyleSheet.create((theme) => ({
    tabs: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
    tab: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: theme.colors.surface },
    selected: { backgroundColor: theme.colors.surfaceSelected },
    pressed: { backgroundColor: theme.colors.surfacePressed },
    text: { minWidth: 0, flexShrink: 1, fontSize: 12, color: theme.colors.textSecondary, ...Typography.default('semiBold') },
    selectedText: { color: theme.colors.text },
}));
