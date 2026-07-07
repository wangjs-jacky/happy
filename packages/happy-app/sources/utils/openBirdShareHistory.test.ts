import { describe, expect, it } from 'vitest';
import {
    loadOpenBirdShareHistory,
    loadLatestOpenBirdShare,
    rememberOpenBirdShare,
    type OpenBirdShareHistoryEntry,
} from './openBirdShareHistory';

describe('openBirdShareHistory', () => {
    it('keeps the latest share link for a session and caps older history', () => {
        for (let index = 1; index <= 7; index += 1) {
            rememberOpenBirdShare('session-1', {
                url: `https://openbird.example/share-${index}`,
                slug: `share-${index}`,
                sharedAt: index,
            });
        }

        const history = loadOpenBirdShareHistory('session-1');
        expect(history.map((entry) => entry.url)).toEqual([
            'https://openbird.example/share-7',
            'https://openbird.example/share-6',
            'https://openbird.example/share-5',
            'https://openbird.example/share-4',
            'https://openbird.example/share-3',
        ]);
        expect(loadLatestOpenBirdShare('session-1')?.url).toBe('https://openbird.example/share-7');
    });

    it('replaces an existing URL entry instead of duplicating it', () => {
        const first: OpenBirdShareHistoryEntry = {
            url: 'https://openbird.example/same',
            slug: 'same',
            sharedAt: 10,
        };
        rememberOpenBirdShare('session-2', first);
        rememberOpenBirdShare('session-2', {
            ...first,
            sharedAt: 20,
        });

        expect(loadOpenBirdShareHistory('session-2')).toEqual([
            {
                url: 'https://openbird.example/same',
                slug: 'same',
                sharedAt: 20,
            },
        ]);
    });
});
