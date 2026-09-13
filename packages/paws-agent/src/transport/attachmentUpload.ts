import { PawsAgentError } from '../client/errors';

export type AttachmentUpload = {
    ref: string;
    uploadUrl: string;
    method: 'PUT' | 'POST';
    formFields?: Record<string, string>;
};

export function parseAttachmentUpload(value: unknown, serverUrl: string): AttachmentUpload {
    const invalid = () => new PawsAgentError('PROTOCOL_UNSUPPORTED', 'Invalid attachment upload descriptor');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const raw = value as Record<string, unknown>;
    if (typeof raw.ref !== 'string' || !raw.ref.trim() || typeof raw.uploadUrl !== 'string' || !raw.uploadUrl.trim()
        || (raw.method !== 'PUT' && raw.method !== 'POST')) throw invalid();
    if (raw.formFields !== undefined && (!raw.formFields || typeof raw.formFields !== 'object'
        || Array.isArray(raw.formFields) || Object.values(raw.formFields).some(v => typeof v !== 'string')
        || Object.hasOwn(raw.formFields, 'file'))) throw invalid();
    let url: URL;
    const server = new URL(serverUrl);
    try { url = new URL(raw.uploadUrl, server); } catch { throw invalid(); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw invalid();
    // 自托管服务可能返回自身 loopback；替换成客户端实际连接的 origin。
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        url.protocol = server.protocol;
        url.host = server.host;
        url.port = server.port;
    }
    // 保留显式配置的 HTTP 自托管服务；第三方对象存储必须使用 HTTPS。
    if (url.protocol !== 'https:' && !(server.protocol === 'http:' && url.origin === server.origin)) throw invalid();
    return { ref: raw.ref, uploadUrl: url.toString(), method: raw.method, formFields: raw.formFields as Record<string, string> | undefined };
}
