import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadOriginalAttachment = vi.hoisted(() => vi.fn());

vi.mock('./downloadOriginalAttachment.android', () => ({ downloadOriginalAttachment }));

import { downloadVideoAttachment } from './downloadVideoAttachment.android';

describe('downloadVideoAttachment on Android', () => {
    beforeEach(() => vi.clearAllMocks());

    it('saves the staged MP4 through the bounded Android directory-writer path', async () => {
        downloadOriginalAttachment.mockResolvedValue(true);

        await expect(downloadVideoAttachment(
            'file:///cache/acceptance.mp4',
            'acceptance.mp4',
            'video/mp4',
        )).resolves.toBe(true);

        expect(downloadOriginalAttachment).toHaveBeenCalledWith(
            'file:///cache/acceptance.mp4',
            'acceptance.mp4',
            'video/mp4',
        );
    });
});
