import { describe, expect, it } from 'vitest';
import { validateReleaseContract } from '../scripts/release-contract.mjs';
import { assertMatchingIntegrity } from '../scripts/verify-registry-integrity.mjs';
import { validateReleasePreparation } from '../scripts/prepare-release.mjs';
import * as releaseContract from '../scripts/release-contract.mjs';

describe('release contract', () => {
    it('only authorizes the exact tarball digest verified in Ego', () => {
        const digest = 'a'.repeat(64);
        expect(releaseContract.assertEgoVerifiedDigest(digest, digest)).toBe(digest);
        expect(() => releaseContract.assertEgoVerifiedDigest('', digest)).toThrow();
        expect(() => releaseContract.assertEgoVerifiedDigest(digest, 'b'.repeat(64))).toThrow();
        expect(() => releaseContract.assertEgoVerifiedDigest('not-a-hash', 'not-a-hash')).toThrow();
    });
    it('maps prereleases to next and stable releases to latest', () => {
        expect(validateReleaseContract({ tag: 'paws-agent-v0.1.0-beta.1', version: '0.1.0-beta.1', tagSha: 'abc', headSha: 'abc' }))
            .toEqual({ version: '0.1.0-beta.1', distTag: 'next' });
        expect(validateReleaseContract({ tag: 'paws-agent-v0.1.0', version: '0.1.0', tagSha: 'abc', headSha: 'abc' }))
            .toEqual({ version: '0.1.0', distTag: 'latest' });
    });

    it('rejects tag/version and source mismatches', () => {
        expect(() => validateReleaseContract({ tag: 'paws-agent-v0.1.1', version: '0.1.0', tagSha: 'abc', headSha: 'abc' })).toThrow();
        expect(() => validateReleaseContract({ tag: 'paws-agent-v0.1.0', version: '0.1.0', tagSha: 'abc', headSha: 'def' })).toThrow();
    });

    it('requires release preparation to happen on the version-owned PR branch', () => {
        expect(validateReleasePreparation({ branch: 'release/paws-agent-v0.2.0', version: '0.2.0' }))
            .toEqual({ branch: 'release/paws-agent-v0.2.0', version: '0.2.0' });
        expect(() => validateReleasePreparation({ branch: 'main', version: '0.2.0' })).toThrow();
        expect(() => validateReleasePreparation({ branch: 'release/paws-agent-v0.2.1', version: '0.2.0' })).toThrow();
        expect(() => validateReleasePreparation({ branch: 'release/paws-agent-next', version: 'next' })).toThrow();
    });

    it('rejects an existing registry version unless it is byte-identical to the local tarball', () => {
        expect(() => assertMatchingIntegrity('sha512-local', 'sha512-registry')).toThrow();
        expect(assertMatchingIntegrity('sha512-same', 'sha512-same')).toBe('sha512-same');
    });
});
