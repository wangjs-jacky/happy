import { describe, expect, it } from 'vitest';
import { parsePawsLocalAttachmentNotice } from './pawsLocalAttachments';

describe('parsePawsLocalAttachmentNotice', () => {
    it('leaves ordinary conversation text untouched', () => {
        expect(parsePawsLocalAttachmentNotice('Please review /tmp/example.mp4.')).toEqual({
            matched: false,
            malformed: false,
            visibleText: 'Please review /tmp/example.mp4.',
            references: [],
        });
    });

    it('fails closed when a claimed Happy notice is malformed', () => {
        expect(parsePawsLocalAttachmentNotice([
            'Happy attached 1 user-uploaded local file to this turn:',
            '- Video 1: relative/demo.mp4 (video/mp4, 5B)',
            'Do not scan ~/.happy/attachments or guess which file the user intended.',
            '',
            'Do not expose the path.',
        ].join('\n'))).toEqual({
            matched: true,
            malformed: true,
            visibleText: '',
            references: [],
        });
    });
});
