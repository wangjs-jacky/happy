export type SessionRouteOwner = Readonly<{
    sessionId: string;
    ownerEpoch: number;
    phase: 'opening' | 'interactive';
}>;

export class SessionRouteAbandonedError extends Error {
    constructor() {
        super('Session route abandoned');
    }
}

/** Coordination exhausted its one same-owner recovery, not a network retry. */
export class SessionRouteCoordinationError extends Error {
    constructor() {
        super('Session latest page was not committed after recovery');
        this.name = 'SessionRouteCoordinationError';
    }
}

/** Route retention is independent of the interactive read/unread state. */
export class SessionRouteOwnership {
    private owner: SessionRouteOwner | null = null;
    private nextEpoch = 0;

    enter(sessionId: string): SessionRouteOwner {
        return this.owner = { sessionId, ownerEpoch: ++this.nextEpoch, phase: 'opening' };
    }

    promote(owner: SessionRouteOwner): SessionRouteOwner | null {
        if (!this.owns(owner)) return null;
        return this.owner = { ...owner, phase: 'interactive' };
    }

    current(): SessionRouteOwner | null {
        return this.owner;
    }

    owns(owner: SessionRouteOwner): boolean {
        return this.owner?.sessionId === owner.sessionId && this.owner.ownerEpoch === owner.ownerEpoch;
    }

    ownsSession(sessionId: string): boolean {
        return this.owner?.sessionId === sessionId;
    }

    leave(owner: SessionRouteOwner): boolean {
        if (!this.owns(owner)) return false;
        this.owner = null;
        return true;
    }
}
