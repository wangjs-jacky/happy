import {
    getImageDownloadFileName,
    type ImageDownloadSource,
} from './imageDownloadCore';

export type DownloadImageOptions = {
    dialogTitle?: string;
};

export async function downloadImage(source: ImageDownloadSource, _options: DownloadImageOptions = {}): Promise<string> {
    const filename = getImageDownloadFileName(source);
    const { href, cleanup } = await getDownloadHref(source.uri);

    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    cleanup();
    return filename;
}

async function getDownloadHref(uri: string): Promise<{ href: string; cleanup: () => void }> {
    if (/^https?:\/\//i.test(uri)) {
        try {
            const response = await fetch(uri);
            if (response.ok) {
                const objectUrl = URL.createObjectURL(await response.blob());
                return {
                    href: objectUrl,
                    cleanup: () => window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0),
                };
            }
        } catch {
            // Fall back to the raw URL. The browser may open it if download is
            // blocked by CORS, which is still better than failing the button.
        }
    }

    return { href: uri, cleanup: () => undefined };
}
