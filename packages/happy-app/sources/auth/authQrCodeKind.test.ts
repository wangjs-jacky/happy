import { describe, expect, it } from 'vitest';
import { getAuthQrCodeKind } from './authQrCodeKind';

describe('getAuthQrCodeKind', () => {
    it.each([
        ['paws:///account?account-public-key', 'account'],
        ['paws://terminal?terminal-public-key', 'terminal'],
        ['https://example.com/not-a-paws-code', null],
    ] as const)('classifies %s as %s', (url, expectedKind) => {
        expect(getAuthQrCodeKind(url)).toBe(expectedKind);
    });
});
