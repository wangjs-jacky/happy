import * as React from 'react';

export type SessionRightPanelNavigation = {
    openBrowserSteps: () => void;
};

const SessionRightPanelNavigationContext = React.createContext<SessionRightPanelNavigation | null>(null);

export const SessionRightPanelNavigationProvider = SessionRightPanelNavigationContext.Provider;

export function useSessionRightPanelNavigation(): SessionRightPanelNavigation | null {
    return React.useContext(SessionRightPanelNavigationContext);
}
