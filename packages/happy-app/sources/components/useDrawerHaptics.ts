import * as React from 'react';
import { Platform } from 'react-native';
import { useDrawerStatus } from '@react-navigation/drawer';
import { hapticsLight } from './haptics';

/**
 * Fires a light haptic each time the drawer settles open or closed.
 * Must be called from a component rendered inside the drawer navigator.
 */
export function useDrawerHaptics() {
    const status = useDrawerStatus(); // 'open' | 'closed'
    const prev = React.useRef(status);
    React.useEffect(() => {
        if (status !== prev.current) {
            prev.current = status;
            if (Platform.OS !== 'web') {
                hapticsLight();
            }
        }
    }, [status]);
}
