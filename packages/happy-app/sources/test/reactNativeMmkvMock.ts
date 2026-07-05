type StoredValue = string | number | boolean | ArrayBuffer;

class MockMMKV {
    private readonly storage = new Map<string, StoredValue>();

    constructor(_configuration?: unknown) {}

    set(key: string, value: StoredValue): void {
        this.storage.set(key, value);
    }

    getString(key: string): string | undefined {
        const value = this.storage.get(key);
        return typeof value === 'string' ? value : undefined;
    }

    getNumber(key: string): number | undefined {
        const value = this.storage.get(key);
        return typeof value === 'number' ? value : undefined;
    }

    getBoolean(key: string): boolean | undefined {
        const value = this.storage.get(key);
        return typeof value === 'boolean' ? value : undefined;
    }

    getBuffer(key: string): ArrayBuffer | undefined {
        const value = this.storage.get(key);
        return value instanceof ArrayBuffer ? value : undefined;
    }

    contains(key: string): boolean {
        return this.storage.has(key);
    }

    delete(key: string): void {
        this.storage.delete(key);
    }

    getAllKeys(): string[] {
        return Array.from(this.storage.keys());
    }

    clearAll(): void {
        this.storage.clear();
    }

    recrypt(_key?: string): void {}

    trim(): void {}

    get size(): number {
        return this.storage.size;
    }

    get isReadOnly(): boolean {
        return false;
    }
}

export const MMKV = MockMMKV;
