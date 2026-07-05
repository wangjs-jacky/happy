type SessionPermissionModeCarrier = {
    permissionMode?: string | null;
};

export function normalizeSavedSessionPermissionMode(mode: string | null | undefined): string | null {
    return mode && mode !== 'default' ? mode : null;
}

export function resolveRestoredSessionPermissionMode(options: {
    existingPermissionMode: string | null | undefined;
    savedPermissionMode: string | null | undefined;
    incomingPermissionMode: string | null | undefined;
}): string | null {
    const savedPermissionMode = normalizeSavedSessionPermissionMode(options.savedPermissionMode);
    const existingPermissionMode = options.existingPermissionMode === 'default' && savedPermissionMode !== null
        ? null
        : (options.existingPermissionMode ?? null);

    return existingPermissionMode
        ?? savedPermissionMode
        ?? options.incomingPermissionMode
        ?? null;
}

export function collectPersistedSessionPermissionModes(
    sessions: Record<string, SessionPermissionModeCarrier>,
): Record<string, string> {
    const modes: Record<string, string> = {};
    Object.entries(sessions).forEach(([id, session]) => {
        const mode = normalizeSavedSessionPermissionMode(session.permissionMode);
        if (mode) {
            modes[id] = mode;
        }
    });
    return modes;
}
