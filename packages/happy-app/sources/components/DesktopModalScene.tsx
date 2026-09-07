import * as React from 'react';

/** Layout context only: navigation and route params remain owned by Expo Router. */
export const DesktopModalSceneContext = React.createContext(false);
export const useIsDesktopModalScene = () => React.useContext(DesktopModalSceneContext);
