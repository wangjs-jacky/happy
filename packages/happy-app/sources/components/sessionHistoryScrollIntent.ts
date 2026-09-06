export class SessionHistoryScrollIntent {
    private lastWebOffsetY = 0;
    private pending = false;

    noteNativeDrag(): void {
        this.pending = true;
    }

    noteWebScroll(offsetY: number): void {
        if (offsetY === this.lastWebOffsetY) return;
        this.lastWebOffsetY = offsetY;
        this.pending = true;
    }

    consumeAtEnd(): boolean {
        if (!this.pending) return false;
        this.pending = false;
        return true;
    }
}
