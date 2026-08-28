import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import {
    Pressable,
    TextInput,
    type TextInputProps,
    View,
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';

type Props = Omit<TextInputProps, 'secureTextEntry' | 'style'> & {
    hideValueAccessibilityLabel: string;
    showValueAccessibilityLabel: string;
    visibilityButtonTestID?: string;
};

export const SecureTextInput = React.memo(React.forwardRef<TextInput, Props>(function SecureTextInput({
    hideValueAccessibilityLabel,
    showValueAccessibilityLabel,
    visibilityButtonTestID,
    ...inputProps
}, ref) {
    const { theme } = useUnistyles();
    const [valueVisible, setValueVisible] = React.useState(false);

    return (
        <View style={styles.container}>
            <TextInput
                {...inputProps}
                ref={ref}
                secureTextEntry={!valueVisible}
                style={styles.input}
            />
            <Pressable
                accessibilityLabel={valueVisible
                    ? hideValueAccessibilityLabel
                    : showValueAccessibilityLabel}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => setValueVisible((current) => !current)}
                style={({ pressed }) => [styles.visibilityButton, pressed && styles.pressed]}
                testID={visibilityButtonTestID}
            >
                <Ionicons
                    color={theme.colors.textSecondary}
                    name={valueVisible ? 'eye-off-outline' : 'eye-outline'}
                    size={22}
                />
            </Pressable>
        </View>
    );
}));

const styles = StyleSheet.create((theme) => ({
    container: {
        alignItems: 'center',
        backgroundColor: theme.colors.input.background,
        borderColor: theme.colors.divider,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: 'row',
        minHeight: 44,
        overflow: 'hidden',
    },
    input: {
        ...Typography.default(),
        color: theme.colors.text,
        flex: 1,
        fontSize: 15,
        minHeight: 44,
        paddingLeft: 12,
        paddingRight: 4,
    },
    visibilityButton: {
        alignItems: 'center',
        alignSelf: 'stretch',
        justifyContent: 'center',
        minHeight: 44,
        width: 44,
    },
    pressed: {
        opacity: 0.55,
    },
}));
