export type SessionMessageLoadOperation = Readonly<{
    sessionId: string;
    epoch: number;
}>;

export class SessionMessageLoadGate {
    private readonly epochs = new Map<string, number>();
    private nextEpoch = 0;

    begin(sessionId: string): SessionMessageLoadOperation {
        const epoch = ++this.nextEpoch;
        this.epochs.set(sessionId, epoch);
        return { sessionId, epoch };
    }

    invalidate(sessionId: string): void {
        this.epochs.delete(sessionId);
    }

    isCurrent(operation: SessionMessageLoadOperation): boolean {
        return this.epochs.get(operation.sessionId) === operation.epoch;
    }

    assertCurrent(operation: SessionMessageLoadOperation): void {
        if (!this.isCurrent(operation)) {
            throw new Error('Session message load abandoned');
        }
    }

    leave(operation: SessionMessageLoadOperation): void {
        if (this.isCurrent(operation)) {
            this.invalidate(operation.sessionId);
        }
    }
}
