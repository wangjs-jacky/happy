import { describe, expect, it, vi } from 'vitest';
import { getAvatarUrl, type Profile } from './profile';

vi.mock('./serverConfig', () => ({
    getServerUrl: () => 'https://happy.test',
}));

function makeProfile(avatarUrl: string): Profile {
    return {
        id: 'u1',
        timestamp: 1,
        firstName: null,
        lastName: null,
        github: null,
        connectedServices: [],
        avatar: {
            width: 40,
            height: 40,
            thumbhash: 'thumb',
            path: 'public/users/u1/avatars/avatar.jpg',
            url: avatarUrl,
        },
    };
}

describe('getAvatarUrl', () => {
    it('resolves server-relative avatar URLs against the configured server', () => {
        expect(getAvatarUrl(makeProfile('/files/public/users/u1/avatars/avatar.jpg'))).toBe(
            'https://happy.test/files/public/users/u1/avatars/avatar.jpg',
        );
    });
});
