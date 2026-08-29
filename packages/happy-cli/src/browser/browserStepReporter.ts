import type { ApiSessionClient } from '@/api/apiSession';
import { open, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, relative } from 'node:path';

export const MAX_BROWSER_STEP_IMAGE_BYTES = 10 * 1024 * 1024;

export type BrowserStepInput = {
    path: string;
    label: string;
};

type BrowserStepReporterClient = Pick<ApiSessionClient, 'uploadImageAttachment' | 'sendFileEvent'>;

type BrowserStepReportResult = {
    success: boolean;
    error?: string;
};

type BrowserStepImage = {
    mimeType: 'image/png' | 'image/jpeg';
    size: number;
};

function browserStepError(code: string, message: string): Error {
    return new Error(`${code}: ${message}`);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function detectBrowserStepImage(header: Uint8Array): BrowserStepImage['mimeType'] | null {
    const isPng = header.length >= 8
        && header[0] === 0x89
        && header[1] === 0x50
        && header[2] === 0x4e
        && header[3] === 0x47
        && header[4] === 0x0d
        && header[5] === 0x0a
        && header[6] === 0x1a
        && header[7] === 0x0a;
    if (isPng) return 'image/png';

    const isJpeg = header.length >= 3
        && header[0] === 0xff
        && header[1] === 0xd8
        && header[2] === 0xff;
    return isJpeg ? 'image/jpeg' : null;
}

export async function validateBrowserStepScreenshot(filePath: string): Promise<BrowserStepImage> {
    if (!isAbsolute(filePath)) {
        throw browserStepError('INVALID_SCREENSHOT_PATH', 'path must be absolute');
    }

    let info;
    try {
        info = await stat(filePath);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
            throw browserStepError('SCREENSHOT_NOT_FOUND', 'file does not exist');
        }
        throw browserStepError('SCREENSHOT_READ_FAILED', errorMessage(error));
    }

    if (!info.isFile()) {
        throw browserStepError('SCREENSHOT_NOT_FILE', 'path is not a regular file');
    }
    if (info.size > MAX_BROWSER_STEP_IMAGE_BYTES) {
        throw browserStepError(
            'IMAGE_TOO_LARGE',
            `browser screenshot exceeds ${MAX_BROWSER_STEP_IMAGE_BYTES} bytes`,
        );
    }

    const file = await open(filePath, 'r');
    try {
        const header = new Uint8Array(12);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        const mimeType = detectBrowserStepImage(header.subarray(0, bytesRead));
        if (!mimeType) {
            throw browserStepError('UNSUPPORTED_IMAGE', 'expected PNG or JPEG bytes');
        }
        return { mimeType, size: info.size };
    } finally {
        await file.close();
    }
}

function isHappyBrowserStepTempFile(filePath: string): boolean {
    const relativePath = relative(tmpdir(), filePath);
    const insideTempDir = relativePath.length > 0
        && !relativePath.startsWith('..')
        && !isAbsolute(relativePath);
    return insideTempDir && basename(filePath).startsWith('happy-browser-step-');
}

async function removeHappyBrowserStepTempFile(filePath: string): Promise<void> {
    if (!isHappyBrowserStepTempFile(filePath)) return;
    try {
        await unlink(filePath);
    } catch {
        // Upload and event delivery already succeeded; cleanup is best effort.
    }
}

/**
 * Deep reporting module: callers provide only a local image path and label;
 * validation, encrypted upload, event emission, error classification, and safe
 * temporary-file cleanup remain local to this implementation.
 */
export function createBrowserStepReporter(client: BrowserStepReporterClient): {
    report: (input: BrowserStepInput) => Promise<BrowserStepReportResult>;
} {
    return {
        report: async (input) => {
            const label = input.label.trim();
            if (!label || label.length > 80) {
                return {
                    success: false,
                    error: 'INVALID_LABEL: label must contain 1 to 80 characters',
                };
            }

            try {
                await validateBrowserStepScreenshot(input.path);
            } catch (error) {
                return { success: false, error: errorMessage(error) };
            }

            let uploaded: Awaited<ReturnType<BrowserStepReporterClient['uploadImageAttachment']>>;
            try {
                uploaded = await client.uploadImageAttachment(input.path);
            } catch (error) {
                return { success: false, error: `UPLOAD_FAILED: ${errorMessage(error)}` };
            }

            try {
                client.sendFileEvent(uploaded.ref, uploaded.name, uploaded.size, uploaded.dims, {
                    source: 'browser_step',
                    browserStep: { label },
                });
            } catch (error) {
                return { success: false, error: `EVENT_SEND_FAILED: ${errorMessage(error)}` };
            }

            await removeHappyBrowserStepTempFile(input.path);
            return { success: true };
        },
    };
}
