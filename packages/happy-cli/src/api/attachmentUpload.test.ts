import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestAttachmentUpload, uploadEncryptedBlob } from './attachmentUpload';

// Mirror the axios-mocking convention used in api.test.ts: a hoisted factory
// exposing default.{post,put}. The bare `vi.mock('axios')` automock is brittle
// here because axios is a default export with a complex shape, so we mock the
// surface we actually use.
const { mockPost, mockPut } = vi.hoisted(() => ({
    mockPost: vi.fn(),
    mockPut: vi.fn(),
}));

vi.mock('axios', () => ({
    default: {
        post: mockPost,
        put: mockPut,
    },
}));

beforeEach(() => {
    mockPost.mockReset();
    mockPut.mockReset();
});

describe('requestAttachmentUpload', () => {
    it('POSTs filename/size with bearer token and returns the upload descriptor', async () => {
        mockPost.mockResolvedValue({ data: { ref: 'sessions/s1/attachments/x.enc', uploadUrl: 'http://srv/up', method: 'PUT' } });
        const res = await requestAttachmentUpload('http://srv', 'tok', 's1', 'pic.png', 123);
        expect(res.ref).toBe('sessions/s1/attachments/x.enc');
        expect(res.method).toBe('PUT');
        const [url, body, cfg] = mockPost.mock.calls[0];
        expect(url).toBe('http://srv/v1/sessions/s1/attachments/request-upload');
        expect(body).toEqual({ filename: 'pic.png', size: 123 });
        expect(cfg.headers.Authorization).toBe('Bearer tok');
    });
});

describe('uploadEncryptedBlob', () => {
    it('PUTs raw bytes to uploadUrl with bearer token for local-storage mode', async () => {
        mockPut.mockResolvedValue({ status: 200 });
        const bytes = new Uint8Array([1, 2, 3]);
        await uploadEncryptedBlob({ ref: 'r', uploadUrl: 'http://srv/up', method: 'PUT' }, bytes, 'tok');
        const [url, data, cfg] = mockPut.mock.calls[0];
        expect(url).toBe('http://srv/up');
        expect(data).toBe(bytes);
        expect(cfg.headers.Authorization).toBe('Bearer tok');
        expect(cfg.headers['Content-Type']).toBe('application/octet-stream');
    });

    it('throws on non-2xx', async () => {
        mockPut.mockResolvedValue({ status: 500 });
        await expect(
            uploadEncryptedBlob({ ref: 'r', uploadUrl: 'http://srv/up', method: 'PUT' }, new Uint8Array([1]), 'tok'),
        ).rejects.toThrow();
    });
});
