import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Command } from './types';
import { Typography } from '@/constants/Typography';
import { Ionicons } from '@expo/vector-icons';
import { useUnistyles } from 'react-native-unistyles';
import { multiplyColorOpacity } from '@/utils/colorOpacity';

interface CommandPaletteItemProps {
    command: Command;
    isSelected: boolean;
    onPress: () => void;
    onHover?: () => void;
}

export function CommandPaletteItem({ command, isSelected, onPress, onHover }: CommandPaletteItemProps) {
    const { theme } = useUnistyles();
    const [isHovered, setIsHovered] = React.useState(false);
    
    const handleMouseEnter = React.useCallback(() => {
        if (Platform.OS === 'web') {
            setIsHovered(true);
            onHover?.();
        }
    }, [onHover]);
    
    const handleMouseLeave = React.useCallback(() => {
        if (Platform.OS === 'web') {
            setIsHovered(false);
        }
    }, []);
    
    const pressableProps: any = {
        testID: `command-palette-item-${command.id}`,
        style: ({ pressed }: any) => [
            styles.container,
            isSelected && {
                backgroundColor: theme.colors.surfaceHighest,
                borderColor: multiplyColorOpacity(theme.colors.accent, 0.2),
            },
            isHovered && !isSelected && { backgroundColor: theme.colors.surfaceHigh },
            pressed && Platform.OS === 'web' && {
                backgroundColor: multiplyColorOpacity(theme.colors.accent, 0.12),
            },
        ],
        onPress,
    };
    
    // Add mouse events only on web
    if (Platform.OS === 'web') {
        pressableProps.onMouseEnter = handleMouseEnter;
        pressableProps.onMouseLeave = handleMouseLeave;
    }
    
    return (
        <Pressable {...pressableProps}>
            <View style={styles.content}>
                {command.icon && (
                    <View style={[styles.iconContainer, { backgroundColor: theme.colors.surfaceHigh }]}>
                        <Ionicons 
                            name={command.icon as any} 
                            size={20} 
                            color={isSelected ? theme.colors.accent : theme.colors.textSecondary}
                        />
                    </View>
                )}
                <View style={styles.textContainer}>
                    <Text style={[styles.title, Typography.default(), { color: theme.colors.text }]}>
                        {command.title}
                    </Text>
                    {command.subtitle && (
                        <Text style={[styles.subtitle, Typography.default(), { color: theme.colors.textSecondary }]}>
                            {command.subtitle}
                        </Text>
                    )}
                </View>
                {command.shortcut && (
                    <View style={[styles.shortcutContainer, { backgroundColor: theme.colors.surfaceHigh }]}>
                        <Text style={[styles.shortcut, Typography.mono(), { color: theme.colors.textSecondary }]}>
                            {command.shortcut}
                        </Text>
                    </View>
                )}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        backgroundColor: 'transparent',
        marginHorizontal: 8,
        marginVertical: 2,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: 'transparent',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    iconContainer: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    textContainer: {
        flex: 1,
        marginRight: 12,
    },
    title: {
        fontSize: 15,
        marginBottom: 2,
        letterSpacing: -0.2,
    },
    subtitle: {
        fontSize: 13,
        letterSpacing: -0.1,
    },
    shortcutContainer: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
    },
    shortcut: {
        fontSize: 12,
        fontWeight: '500',
    },
});
