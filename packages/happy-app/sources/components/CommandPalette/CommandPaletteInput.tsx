import React from 'react';
import { View, TextInput, StyleSheet, Platform } from 'react-native';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { useUnistyles } from 'react-native-unistyles';
import { multiplyColorOpacity } from '@/utils/colorOpacity';

interface CommandPaletteInputProps {
    value: string;
    onChangeText: (text: string) => void;
    onKeyPress?: (key: string) => void;
    inputRef?: React.RefObject<TextInput | null>;
}

export function CommandPaletteInput({ value, onChangeText, onKeyPress, inputRef }: CommandPaletteInputProps) {
    const { theme } = useUnistyles();
    const handleKeyDown = React.useCallback((e: any) => {
        if (Platform.OS === 'web' && onKeyPress) {
            const key = e.nativeEvent.key;
            
            // Handle navigation keys
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(key)) {
                e.preventDefault();
                e.stopPropagation();
                onKeyPress(key);
            }
        }
    }, [onKeyPress]);

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: theme.colors.surfaceHigh,
                    borderBottomColor: multiplyColorOpacity(theme.colors.text, 0.12),
                },
            ]}
        >
            <TextInput
                testID="command-palette-input"
                ref={inputRef}
                style={[styles.input, Typography.default(), { color: theme.colors.text }]}
                value={value}
                onChangeText={onChangeText}
                placeholder={t('commandPalette.placeholder')}
                placeholderTextColor={theme.colors.textSecondary}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="go"
                onKeyPress={handleKeyDown}
                blurOnSubmit={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderBottomWidth: 1,
    },
    input: {
        paddingHorizontal: 32,
        paddingVertical: 24,
        fontSize: 20,
        letterSpacing: -0.3,
        // Remove outline on web
        ...(Platform.OS === 'web' ? {
            outlineStyle: 'none',
            outlineWidth: 0,
        } as any : {}),
    },
});
