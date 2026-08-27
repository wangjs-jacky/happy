import { describe, expect, it } from 'vitest';
import { validateReleaseContract } from '../scripts/release-contract.mjs';

describe('release contract', () => {
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
});
