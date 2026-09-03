import { describe, expect, it } from 'vitest';
import { getAuthQrCodeKind } from './authQrCodeKind';

describe('getAuthQrCodeKind', () => {
    it.each([
        ['paws:///account?account-public-key', 'account'],
        ['paws://terminal?terminal-public-key', 'terminal'],
        ['paws:///account?', null],
        ['paws://terminal?', null],
        ['paws:///account?not valid', null],
        ['paws://terminal?<script>', null],
        ['https://example.com/not-a-paws-code', null],
    ] as const)('classifies %s as %s', (url, expectedKind) => {
        expect(getAuthQrCodeKind(url)).toBe(expectedKind);
    });
});
