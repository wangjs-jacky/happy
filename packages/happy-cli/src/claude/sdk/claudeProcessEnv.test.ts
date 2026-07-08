import { describe, expect, it } from 'vitest'

import { buildClaudeProcessEnv } from './claudeProcessEnv'

describe('buildClaudeProcessEnv', () => {
    it('passes the environment through unchanged when no Claude proxy vars are set', () => {
        const env = buildClaudeProcessEnv({ PATH: '/usr/bin', HOME: '/home/u' })
        expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u' })
        expect(env.HTTP_PROXY).toBeUndefined()
        expect(env.NODE_EXTRA_CA_CERTS).toBeUndefined()
    })

    it('drops non-string values', () => {
        const env = buildClaudeProcessEnv({ PATH: '/usr/bin', BROKEN: undefined })
        expect(env).toEqual({ PATH: '/usr/bin' })
    })

    it('overrides all proxy variables when HAPPY_CLAUDE_PROXY_URL is set', () => {
        const env = buildClaudeProcessEnv({
            HAPPY_CLAUDE_PROXY_URL: 'http://127.0.0.1:53745',
            HTTP_PROXY: 'http://other-proxy:1080',
            https_proxy: 'http://other-proxy:1080',
        })
        for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
            expect(env[key]).toBe('http://127.0.0.1:53745')
        }
    })

    it('falls back to CLAUDE_PROXY_URL when the HAPPY_ variant is absent', () => {
        const env = buildClaudeProcessEnv({ CLAUDE_PROXY_URL: 'http://127.0.0.1:9999' })
        expect(env.HTTP_PROXY).toBe('http://127.0.0.1:9999')
        expect(env.all_proxy).toBe('http://127.0.0.1:9999')
    })

    it('prefers HAPPY_CLAUDE_PROXY_URL over CLAUDE_PROXY_URL', () => {
        const env = buildClaudeProcessEnv({
            HAPPY_CLAUDE_PROXY_URL: 'http://127.0.0.1:1111',
            CLAUDE_PROXY_URL: 'http://127.0.0.1:2222',
        })
        expect(env.HTTPS_PROXY).toBe('http://127.0.0.1:1111')
    })

    it('maps HAPPY_CLAUDE_EXTRA_CA_CERTS to NODE_EXTRA_CA_CERTS', () => {
        const env = buildClaudeProcessEnv({
            HAPPY_CLAUDE_EXTRA_CA_CERTS: '/home/u/.gateway/ca.pem',
            NODE_EXTRA_CA_CERTS: '/etc/ssl/other.pem',
        })
        expect(env.NODE_EXTRA_CA_CERTS).toBe('/home/u/.gateway/ca.pem')
    })

    it('leaves an existing NODE_EXTRA_CA_CERTS alone when no Claude CA var is set', () => {
        const env = buildClaudeProcessEnv({ NODE_EXTRA_CA_CERTS: '/etc/ssl/other.pem' })
        expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/other.pem')
    })

    it('combines proxy and CA overrides independently of other env vars', () => {
        const env = buildClaudeProcessEnv({
            HAPPY_CLAUDE_PROXY_URL: 'http://127.0.0.1:53745',
            HAPPY_CLAUDE_EXTRA_CA_CERTS: '/home/u/.gateway/ca.pem',
            HAPPY_SERVER_URL: 'http://relay.example:3005',
            NO_PROXY: 'localhost,relay.example',
        })
        expect(env.HTTP_PROXY).toBe('http://127.0.0.1:53745')
        expect(env.NODE_EXTRA_CA_CERTS).toBe('/home/u/.gateway/ca.pem')
        expect(env.HAPPY_SERVER_URL).toBe('http://relay.example:3005')
        expect(env.NO_PROXY).toBe('localhost,relay.example')
    })
})
