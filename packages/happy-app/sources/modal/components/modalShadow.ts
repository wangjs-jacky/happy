import { Platform, type ViewStyle } from 'react-native';
import { multiplyColorOpacity } from '@/utils/colorOpacity';

export function getModalShadowStyle(shadowColor: string): ViewStyle {
    if (Platform.OS === 'web') {
        return {
            boxShadow: `0 2px 4px ${multiplyColorOpacity(shadowColor, 0.25)}`,
        };
    }

    return {
        shadowColor,
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    };
}
