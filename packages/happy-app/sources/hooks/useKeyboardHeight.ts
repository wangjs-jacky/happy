import * as React from 'react';
import { Keyboard, Platform, LayoutAnimation } from 'react-native';

/**
 * Tracks the on-screen keyboard height.
 *
 * Why a dedicated hook (instead of react-native-keyboard-controller's
 * KeyboardAvoidingView): the bottom-sheet picker renders inside a native
 * RN `Modal`. On Android a Modal is a separate Dialog window, and the
 * keyboard-controller native module does not emit keyboard events for it —
 * so KeyboardAvoidingView silently does nothing there. React Native's plain
 * `Keyboard` events DO fire inside Modals on both platforms, making them the
 * reliable choice for lifting sheet content above the keyboard.
 *
 * Returns the keyboard height (0 when hidden). Changes are wrapped in a
 * LayoutAnimation so consumers animate smoothly when used as padding/margin.
 */
export function useKeyboardHeight(): number {
    const [height, setHeight] = React.useState(0);

    React.useEffect(() => {
        // iOS fires the *Will* events (in sync with the keyboard animation);
        // Android only reliably fires the *Did* events.
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const onShow = (e: { endCoordinates: { height: number } }) => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setHeight(e.endCoordinates.height);
        };
        const onHide = () => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setHeight(0);
        };

        const showSub = Keyboard.addListener(showEvent, onShow);
        const hideSub = Keyboard.addListener(hideEvent, onHide);
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    return height;
}
