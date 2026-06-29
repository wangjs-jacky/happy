import * as React from 'react';
import { useDrawerStatus } from '@react-navigation/drawer';
import { hapticsLight } from './haptics';

/**
 * Fires a light haptic each time the drawer settles open or closed.
 * Must be called from a component rendered inside the drawer navigator.
 * hapticsLight is a no-op on web (haptics.web.ts) and self-gates on the
 * global setting, so no platform/enabled guard is needed here.
 */
export function useDrawerHaptics() {
    const status = useDrawerStatus(); // 'open' | 'closed'
    const prev = React.useRef(status);
    React.useEffect(() => {
        if (status !== prev.current) {
            prev.current = status;
            hapticsLight();
        }
    }, [status]);
}
