import React from 'react';
import { View, ScrollView, TextInput, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { Stack } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { layout } from '@/components/layout';
import { useSettingMutable } from '@/sync/storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { t } from '@/text';

export default React.memo(function CustomInstructionsScreen() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const safeArea = useSafeAreaInsets();
    const [value, setValue] = useSettingMutable('customInstructions');
    const [focused, setFocused] = React.useState(false);

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
                    headerTitle: t('settings.customInstructions'),
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
                            {t('customInstructions.intro')}
                        </Text>
                        <Text style={styles.label}>{t('customInstructions.label')}</Text>
                        <TextInput
                            style={[
                                styles.input,
                                styles.textArea,
                                focused && styles.inputFocused,
                                Platform.OS === 'web' && ({ outlineStyle: 'none', outlineWidth: 0 } as any),
                            ]}
                            value={value}
                            onChangeText={setValue}
                            accessibilityLabel={t('customInstructions.label')}
                            placeholder={t('customInstructions.placeholder')}
                            placeholderTextColor={theme.colors.input.placeholder}
                            onFocus={() => setFocused(true)}
                            onBlur={() => setFocused(false)}
                            multiline
                            numberOfLines={12}
                            autoCapitalize="sentences"
                            autoCorrect={false}
                        />
                        <Text style={styles.footer}>
                            {t('customInstructions.footer')}
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
}));
