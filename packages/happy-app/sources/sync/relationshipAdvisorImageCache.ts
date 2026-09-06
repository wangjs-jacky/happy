import { Directory, File, Paths } from 'expo-file-system';
import { notifyAdvisorImageChanged, type AdvisorImageSource } from './relationshipAdvisorImageEvents';

// Deletion wins over in-flight picker reads that have not reached write() yet.
const deletedKeys = new Set<string>();

function imageFile(key: string) {
    if (!/^[A-Za-z0-9_-]{1,100}\.(?:jpg|png|webp)$/.test(key)) throw new Error('Invalid image cache key');
    return new File(Paths.document, 'relationship-advisor-images', key);
}

/** Private, device-local originals survive picker cleanup and application restarts. */
export async function writeAdvisorImage(key: string, bytes: Uint8Array): Promise<void> {
    if (deletedKeys.has(key)) throw new Error('Image was removed');
    new Directory(Paths.document, 'relationship-advisor-images').create({ intermediates: true, idempotent: true });
    imageFile(key).write(bytes);
    notifyAdvisorImageChanged(key);
}

/** Use the private original directly; never persist an expiring picker URI. */
export async function loadAdvisorImageSource(key: string): Promise<AdvisorImageSource> {
    const file = imageFile(key);
    if (!file.exists || file.size > 10 * 1024 * 1024) throw new Error('Image is unavailable');
    return { uri: file.uri, release: () => {} };
}

export async function readAdvisorImage(key: string): Promise<Uint8Array> {
    const file = imageFile(key);
    if (file.size > 10 * 1024 * 1024) throw new Error('Image cache entry is too large');
    return file.bytes();
}

export async function deleteAdvisorImages(keys: string[]): Promise<void> {
    keys.forEach((key) => deletedKeys.add(key));
    for (const key of keys) {
        const file = imageFile(key);
        if (file.exists) file.delete();
        notifyAdvisorImageChanged(key);
    }
}
