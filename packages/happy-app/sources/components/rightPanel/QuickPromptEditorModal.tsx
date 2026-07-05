import * as React from 'react';
import { Platform, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

type QuickPromptEditorModalProps = {
    onClose: () => void;
    onSave: (value: { title: string; prompt: string }) => void;
};

const TITLE_MAX_LENGTH = 44;

function deriveTitle(prompt: string): string {
    const firstLine = prompt
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? 'Prompt';
    const normalized = firstLine.replace(/\s+/g, ' ');
    return normalized.length > TITLE_MAX_LENGTH
        ? `${normalized.slice(0, TITLE_MAX_LENGTH - 1)}...`
        : normalized;
}

export const QuickPromptEditorModal = React.memo(function QuickPromptEditorModal({
    onClose,
    onSave,
}: QuickPromptEditorModalProps) {
    const { theme } = useUnistyles();
    const { width, height } = useWindowDimensions();
    const promptRef = React.useRef<TextInput>(null);
    const [title, setTitle] = React.useState('');
    const [prompt, setPrompt] = React.useState('');

    const trimmedPrompt = prompt.trim();
    const canSave = trimmedPrompt.length > 0;
    const modalWidth = Math.min(Math.max(width - 32, 288), 380);
    const promptHeight = Math.min(Math.max(height * 0.34, 190), 320);

    const handleSave = React.useCallback(() => {
        if (!canSave) return;
        onSave({
            title: title.trim() || deriveTitle(trimmedPrompt),
            prompt: trimmedPrompt,
        });
        onClose();
    }, [canSave, onClose, onSave, title, trimmedPrompt]);

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: theme.colors.surface,
                    shadowColor: theme.colors.shadow.color,
                    width: modalWidth,
                    maxHeight: height - 56,
                },
            ]}
        >
            <View style={styles.header}>
                <Text style={[styles.title, { color: theme.colors.text }, Typography.default('semiBold')]}>
                    {t('rightPanelCapabilityHub.quickPrompt.add')}
                </Text>
                <Text style={[styles.message, { color: theme.colors.textSecondary }, Typography.default()]}>
                    {t('rightPanelCapabilityHub.quickPrompt.addBodyMessage')}
                </Text>
            </View>

            <View style={styles.form}>
                <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.colors.text }, Typography.default('semiBold')]}>
                        {t('rightPanelCapabilityHub.quickPrompt.addTitle')}
                    </Text>
                    <TextInput
                        style={[
                            styles.titleInput,
                            {
                                backgroundColor: theme.colors.input.background,
                                borderColor: theme.colors.divider,
                                color: theme.colors.text,
                            },
                            Typography.default(),
                        ]}
                        value={title}
                        onChangeText={setTitle}
                        placeholder={t('rightPanelCapabilityHub.quickPrompt.titlePlaceholder')}
                        placeholderTextColor={theme.colors.input.placeholder}
                        returnKeyType="next"
                        autoCapitalize="sentences"
                        autoCorrect={false}
                        autoFocus={Platform.OS === 'web'}
                        onSubmitEditing={() => promptRef.current?.focus()}
                    />
                </View>

                <View style={styles.field}>
                    <Text style={[styles.label, { color: theme.colors.text }, Typography.default('semiBold')]}>
                        {t('rightPanelCapabilityHub.quickPrompt.addBodyTitle')}
                    </Text>
                    <TextInput
                        ref={promptRef}
                        style={[
                            styles.promptInput,
                            {
                                backgroundColor: theme.colors.input.background,
                                borderColor: theme.colors.divider,
                                color: theme.colors.text,
                                height: promptHeight,
                            },
                            Typography.default(),
                        ]}
                        value={prompt}
                        onChangeText={setPrompt}
                        placeholder={t('rightPanelCapabilityHub.quickPrompt.bodyPlaceholder')}
                        placeholderTextColor={theme.colors.input.placeholder}
                        multiline={true}
                        textAlignVertical="top"
                        autoCapitalize="sentences"
                        autoCorrect={false}
                    />
                </View>
            </View>

            <View style={[styles.actions, { borderTopColor: theme.colors.divider }]}>
                <Pressable
                    onPress={onClose}
                    style={({ pressed }) => [
                        styles.actionButton,
                        pressed ? { backgroundColor: theme.colors.surfaceHigh } : null,
                    ]}
                >
                    <Text style={[styles.cancelText, { color: theme.colors.textLink }, Typography.default()]}>
                        {t('common.cancel')}
                    </Text>
                </Pressable>
                <View style={[styles.actionDivider, { backgroundColor: theme.colors.divider }]} />
                <Pressable
                    disabled={!canSave}
                    onPress={handleSave}
                    style={({ pressed }) => [
                        styles.actionButton,
                        pressed && canSave ? { backgroundColor: theme.colors.surfaceHigh } : null,
                        !canSave ? { opacity: 0.42 } : null,
                    ]}
                >
                    <Text style={[styles.saveText, { color: theme.colors.textLink }, Typography.default('semiBold')]}>
                        {t('common.save')}
                    </Text>
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    card: {
        borderRadius: 18,
        elevation: 8,
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.22,
        shadowRadius: 24,
    },
    header: {
        paddingHorizontal: 18,
        paddingTop: 18,
    },
    title: {
        fontSize: 18,
        marginBottom: 6,
        textAlign: 'left',
    },
    message: {
        fontSize: 13,
        lineHeight: 18,
    },
    form: {
        gap: 14,
        paddingHorizontal: 18,
        paddingVertical: 16,
    },
    field: {
        gap: 7,
    },
    label: {
        fontSize: 13,
    },
    titleInput: {
        borderRadius: 12,
        borderWidth: 1,
        fontSize: 15,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 0,
    },
    promptInput: {
        borderRadius: 12,
        borderWidth: 1,
        fontSize: 15,
        lineHeight: 20,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    actions: {
        borderTopWidth: 1,
        flexDirection: 'row',
    },
    actionButton: {
        alignItems: 'center',
        flex: 1,
        justifyContent: 'center',
        minHeight: 46,
    },
    actionDivider: {
        width: 1,
    },
    cancelText: {
        fontSize: 16,
    },
    saveText: {
        fontSize: 16,
    },
}));
