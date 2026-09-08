export type ReleaseContractInput = {
    tag: string;
    version: string;
    tagSha: string;
    headSha: string;
};

export function assertEgoVerifiedDigest(verifiedSha256: string, actualSha256: string): string;

export function validateReleaseContract(input: ReleaseContractInput): {
    version: string;
    distTag: 'next' | 'latest';
};
