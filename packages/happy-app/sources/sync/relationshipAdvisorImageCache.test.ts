import { describe, it, expect, vi } from 'vitest';

const files = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock('expo-file-system', () => ({
    Paths: { document: 'private-documents' },
    Directory: class { create() {} },
    File: class {
        key: string;
        constructor(...parts: string[]) { this.key = parts.join('/'); }
        write(bytes: Uint8Array) { files.set(this.key, bytes); }
        bytes() { const bytes = files.get(this.key); if (!bytes) throw new Error('Missing'); return bytes; }
        get exists() { return files.has(this.key); }
        get uri() { return `file://${this.key}`; }
        get size() { return files.get(this.key)?.length ?? 0; }
        delete() { files.delete(this.key); }
    },
}));

import { writeAdvisorImage, readAdvisorImage, deleteAdvisorImages, loadAdvisorImageSource } from './relationshipAdvisorImageCache';
import { subscribeAdvisorImageChanges } from './relationshipAdvisorImageEvents';

describe('native advisor originals', () => {
    it('stores original bytes in the private document directory', async () => {
        await writeAdvisorImage('persistent.jpg', new Uint8Array([1, 2, 3]));
        expect(await readAdvisorImage('persistent.jpg')).toEqual(new Uint8Array([1, 2, 3]));
        expect(files.has('private-documents/relationship-advisor-images/persistent.jpg')).toBe(true);
    });

    it('does not resurrect deleted originals when a delayed picker read finishes', async () => {
        await deleteAdvisorImages(['deleted.jpg']);
        await expect(writeAdvisorImage('deleted.jpg', new Uint8Array([1]))).rejects.toThrow('removed');
        expect(files.has('private-documents/relationship-advisor-images/deleted.jpg')).toBe(false);
    });

    it('rejects cache traversal and oversized reads', async () => {
        await expect(writeAdvisorImage('../outside.jpg', new Uint8Array([1]))).rejects.toThrow('Invalid');
        files.set('private-documents/relationship-advisor-images/large.jpg', new Uint8Array(10 * 1024 * 1024 + 1));
        await expect(readAdvisorImage('large.jpg')).rejects.toThrow('too large');
    });

    it('uses a stable local preview URI and notifies mounted messages after save/delete', async () => {
        const changed: string[] = [];
        const unsubscribe = subscribeAdvisorImageChanges((key) => changed.push(key));
        await expect(loadAdvisorImageSource('preview.png')).rejects.toThrow('unavailable');
        await writeAdvisorImage('preview.png', new Uint8Array([1]));
        const source = await loadAdvisorImageSource('preview.png');
        expect(source.uri).toBe('file://private-documents/relationship-advisor-images/preview.png');
        source.release();
        expect(files.has('private-documents/relationship-advisor-images/preview.png')).toBe(true);
        await deleteAdvisorImages(['preview.png']);
        await expect(loadAdvisorImageSource('preview.png')).rejects.toThrow('unavailable');
        unsubscribe();
        expect(changed).toEqual(['preview.png', 'preview.png']);
    });
});
