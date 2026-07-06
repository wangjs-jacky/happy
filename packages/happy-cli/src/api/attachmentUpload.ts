import axios from 'axios';

export interface UploadDescriptor {
    ref: string;
    uploadUrl: string;
    method: 'PUT' | 'POST';
    formFields?: Record<string, string>;
}

/**
 * Ask the server for an upload slot. Mirrors the app-side request-upload call.
 * Returns the ref (stable id used in the file event) and where to PUT/POST the
 * encrypted bytes.
 */
export async function requestAttachmentUpload(
    serverUrl: string,
    token: string,
    sessionId: string,
    filename: string,
    size: number,
): Promise<UploadDescriptor> {
    const url = `${serverUrl}/v1/sessions/${sessionId}/attachments/request-upload`;
    const res = await axios.post(
        url,
        { filename, size },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30000 },
    );
    return res.data as UploadDescriptor;
}

/**
 * Upload the already-encrypted blob. Local-storage mode is a plain PUT to our
 * own server (Bearer required); S3 mode is a presigned POST with formFields and
 * does NOT take an auth header.
 */
export async function uploadEncryptedBlob(
    descriptor: UploadDescriptor,
    encrypted: Uint8Array,
    token: string,
): Promise<void> {
    if (descriptor.method === 'PUT') {
        const res = await axios.put(descriptor.uploadUrl, encrypted, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
            timeout: 60000,
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024,
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`attachment PUT failed: ${res.status}`);
        }
        return;
    }
    // POST (S3 presigned): multipart form with formFields + file.
    const form = new FormData();
    // S3 presigned POST requires all policy fields (esp. `key`) to precede the `file` field and ignores anything after it, so this order (formFields first, then file) is load-bearing and must not be reordered.
    for (const [k, v] of Object.entries(descriptor.formFields ?? {})) {
        form.append(k, v);
    }
    form.append('file', new Blob([encrypted], { type: 'application/octet-stream' }), 'blob');
    const abort = AbortSignal.timeout(60000);
    let res: Response;
    try {
        res = await fetch(descriptor.uploadUrl, {
            method: 'POST',
            body: form,
            signal: abort,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`attachment POST network error: ${message}`);
    }
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`attachment POST failed: ${res.status}${body ? ` ${body}` : ''}`);
    }
}
