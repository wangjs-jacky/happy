import * as React from 'react';
import type { GestureType } from 'react-native-gesture-handler';

export const ExternalHorizontalGestureContext = React.createContext<readonly GestureType[]>([]);

