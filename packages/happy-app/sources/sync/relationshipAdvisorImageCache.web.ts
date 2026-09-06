/** IndexedDB stores originals without exhausting localStorage or relying on expiring blob URLs. */
const deletedKeys = new Set<string>();
async function withImages<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('paws-relationship-advisor-images', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('images');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction('images', mode);
            const request = action(tx.objectStore('images'));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error ?? request.error);
            tx.onabort = () => reject(tx.error ?? new Error('Image cache transaction aborted'));
        });
    } finally {
        db.close();
    }
}

export async function writeAdvisorImage(key: string, bytes: Uint8Array): Promise<void> {
    if (deletedKeys.has(key)) throw new Error('Image was removed');
    await withImages('readwrite', (store) => {
        if (deletedKeys.has(key)) throw new Error('Image was removed');
        // Bounded reads may return a small view onto a 10 MB buffer. IndexedDB
        // clones the whole backing buffer unless we first copy the exact bytes.
        return store.put(bytes.slice(), key);
    });
}

export async function readAdvisorImage(key: string): Promise<Uint8Array> {
    const bytes = await withImages('readonly', (store) => store.get(key));
    if (!(bytes instanceof Uint8Array) || bytes.length > 10 * 1024 * 1024) throw new Error('Image is unavailable');
    return bytes;
}

export async function deleteAdvisorImages(keys: string[]): Promise<void> {
    keys.forEach((key) => deletedKeys.add(key));
    for (const key of keys) await withImages('readwrite', (store) => store.delete(key));
}
