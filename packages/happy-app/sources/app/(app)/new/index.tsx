import * as React from 'react';
import { ComposeHome } from '@/components/ComposeHome';

// The `/new` route is the single new-session entry point used across the app
// (phone "+", tablet empty state, home header, command palette, …). It now
// renders the compose-first page in its pushed-screen variant — a back button
// instead of the home drawer/avatar chrome. All callers keep navigating to
// `/new`; they just land on the new page.
export default React.memo(function NewSessionScreen() {
    return <ComposeHome variant="screen" />;
});
