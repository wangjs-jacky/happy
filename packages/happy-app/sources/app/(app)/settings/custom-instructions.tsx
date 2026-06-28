import React from 'react';
import { View, ScrollView, TextInput, Pressable, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { Modal } from '@/modal';
import { useSettingMutable } from '@/sync/storage';
import { DEFAULT_CUSTOM_INSTRUCTIONS } from '@/sync/settings';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

export default React.memo(function CustomInstructionsScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const [value, setValue] = useSettingMutable('customInstructions');
    const [focused, setFocused] = React.useState(false);

    // Restore the prefilled default (the Happy send_image rule) after confirmation.
    const handleReset = React.useCallback(async () => {
        const ok = await Modal.confirm(
            '恢复默认',
            '将自定义指令恢复为内置的默认内容（图片内联发送规则）？当前内容会被覆盖。',
            { confirmText: '恢复默认', destructive: true }
        );
        if (ok) {
            setValue(DEFAULT_CUSTOM_INSTRUCTIONS);
        }
    }, [setValue]);

    const HeaderRight = React.useCallback(() => (
        <Pressable style={styles.headerButton} onPress={handleReset} hitSlop={8}>
            <Text style={styles.headerButtonText}>恢复默认</Text>
        </Pressable>
    ), [handleReset, styles]);

    const KeyboardWrapper = Platform.select({
        ios: KeyboardAvoidingView,
        default: React.Fragment,
    });
    const keyboardProps = Platform.select({
        ios: { behavior: 'padding' as const, keyboardVerticalOffset: 0 },
        default: {},
    });

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: 'Custom Instructions',
                    headerRight: HeaderRight,
                }}
            />
            <View style={styles.container}>
                <KeyboardWrapper {...keyboardProps}>
                    <ScrollView
                        style={styles.scrollView}
                        contentContainerStyle={[
                            styles.contentContainer,
                            { maxWidth: layout.maxWidth, alignSelf: 'center', width: '100%', paddingBottom: safeArea.bottom + 100 },
                        ]}
                        keyboardShouldPersistTaps="handled"
                    >
                        <Text style={styles.intro}>
                            这里的内容会被追加到每次发送给 AI 的系统提示词里，对所有会话与设备生效（端到端同步）。留空则不追加。
                        </Text>
                        <Text style={styles.label}>指令内容</Text>
                        <TextInput
                            style={[
                                styles.input,
                                styles.textArea,
                                focused && styles.inputFocused,
                                Platform.OS === 'web' && ({ outlineStyle: 'none', outlineWidth: 0 } as any),
                            ]}
                            value={value}
                            onChangeText={setValue}
                            placeholder="输入自定义系统提示词…"
                            placeholderTextColor={theme.colors.input.placeholder}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setFocused(false)}
                            multiline
                            numberOfLines={12}
                            autoCapitalize="sentences"
                            autoCorrect={false}
                        />
                        <Text style={styles.footer}>
                            修改即时保存。默认已预填「图片内联发送」规则——让 AI 用 send_image 工具直接把图片发给你，而不是只显示文件路径。
                        </Text>
                    </ScrollView>
                </KeyboardWrapper>
            </View>
        </>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    scrollView: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
    },
    intro: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        marginBottom: 20,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
        color: theme.colors.textSecondary,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    input: {
        backgroundColor: theme.colors.surface,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: theme.colors.text,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    } as any,
    inputFocused: {
        borderColor: theme.colors.button.primary.background,
    },
    textArea: {
        minHeight: 240,
        textAlignVertical: 'top',
        paddingTop: 14,
        lineHeight: 22,
    },
    footer: {
        fontSize: 13,
        lineHeight: 19,
        color: theme.colors.textSecondary,
        marginTop: 12,
    },
    headerButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    headerButtonText: {
        fontSize: 17,
        fontWeight: '600',
        color: theme.colors.header.tint,
    },
}));
