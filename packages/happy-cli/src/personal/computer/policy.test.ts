import { describe, expect, it } from 'vitest';
import { browserUrl, ComputerControl, publicAddress, workspacePath } from './policy';

describe('Personal computer capability boundaries', () => {
    it('revokes earlier agent actions across takeover and return', () => {
        const control = new ComputerControl();
        const old = control.epoch;
        control.assertAgent(old);
        control.takeover('phone');
        expect(() => control.assertAgent(old)).toThrow();
        expect(() => control.assertAgent(control.epoch)).toThrow();
        const human = control.epoch;
        expect(() => control.release('other-device', human)).toThrow();
        expect(() => control.assertHuman('phone', old)).toThrow();
        control.assertHuman('phone', human);
        control.release('phone', human);
        expect(() => control.assertAgent(old)).toThrow();
        control.assertAgent(control.epoch);
    });

    it('does not grant agent control when the computer stops', () => {
        const control = new ComputerControl();
        control.takeover('phone');
        const epoch = control.epoch;
        control.stop(epoch);
        expect(control.viewer).toBe('phone');
        expect(() => control.assertHuman('phone', epoch)).toThrow();
        expect(() => control.assertAgent(control.epoch)).toThrow();
    });

    it('lets the authenticated owner explicitly reclaim a stale viewer without reviving its lease', () => {
        const control = new ComputerControl();
        control.takeover('phone');
        const epoch = control.epoch;
        control.takeover('refreshed-phone');
        expect(control.epoch).toBeGreaterThan(epoch);
        expect(() => control.assertHuman('phone', epoch)).toThrow();
        expect(() => control.release('phone', epoch)).toThrow();
        control.assertHuman('refreshed-phone', control.epoch);
        control.release('refreshed-phone', control.epoch);
        control.assertAgent(control.epoch);
    });

    it.each(['../profile', '/profile/cookies', '/etc/passwd', '../../etc', 'sub\\..\\secret', '\0'])('rejects workspace escape %j', value => {
        expect(() => workspacePath(value)).toThrow();
    });

    it('keeps normal relative paths in the dedicated workspace', () => {
        expect(workspacePath('notes/result.md')).toBe('/workspace/notes/result.md');
        expect(workspacePath('/workspace/result.md')).toBe('/workspace/result.md');
    });

    it.each(['127.0.0.1', '10.1.2.3', '172.16.1.2', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '2002:7f00:1::'])('denies nonpublic egress %s', value => {
        expect(publicAddress(value)).toBe(false);
    });

    it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('permits public-unicast egress %s', value => {
        expect(publicAddress(value)).toBe(true);
    });

    it.each(['file:///etc/passwd', 'javascript:alert(1)', 'http://localhost/', 'http://127.0.0.1/', 'https://user:password@example.com', 'http://host.local/'])('rejects a privileged browser destination %s', value => {
        expect(() => browserUrl(value)).toThrow();
    });
});
