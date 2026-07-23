import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerUrl, setServerUrl } from './serverConfig';

describe('服务器地址配置', () => {
    beforeEach(() => {
        vi.stubEnv('EXPO_PUBLIC_HAPPY_SERVER_URL', '');
        delete (globalThis as { __HAPPY_CONFIG__?: { serverUrl?: string } }).__HAPPY_CONFIG__;
        setServerUrl(null);
    });

    it('默认使用自托管 API 的 3005 地址', () => {
        expect(getServerUrl()).toBe('http://47.115.228.20:3005');
    });

    it('自动迁移旧版本缓存的 8443 默认地址', () => {
        setServerUrl('https://47.115.228.20:8443');
        expect(getServerUrl()).toBe('http://47.115.228.20:3005');
    });
});
