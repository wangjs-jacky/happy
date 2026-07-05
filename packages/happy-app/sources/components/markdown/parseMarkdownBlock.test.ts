import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parseMarkdown';

const spans = (text: string) => text ? [{ styles: [], text, url: null }] : [];

describe('parseMarkdownBlock - table parsing', () => {

    it('parses a standard table without blank lines', () => {
        const md = [
            '| A | B |',
            '|---|---|',
            '| 1 | 2 |',
        ].join('\n');

        const blocks = parseMarkdown(md);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
            type: 'table',
            headers: [spans('A'), spans('B')],
            rows: [[spans('1'), spans('2')]],
        });
    });

    it('parses a table with blank lines between rows (LLM output)', () => {
        const md = [
            '| A | B |',
            '',
            '|---|---|',
            '',
            '| 1 | 2 |',
            '',
            '| 3 | 4 |',
        ].join('\n');

        const blocks = parseMarkdown(md);
        // Should be recognized as a single table, not 4 separate text blocks
        const tableBlocks = blocks.filter(b => b.type === 'table');
        expect(tableBlocks).toHaveLength(1);
        expect(tableBlocks[0]).toEqual({
            type: 'table',
            headers: [spans('A'), spans('B')],
            rows: [[spans('1'), spans('2')], [spans('3'), spans('4')]],
        });
    });

    it('preserves empty interior cells (e.g. row header column)', () => {
        const md = [
            '| | Header1 | Header2 |',
            '|---|---|---|',
            '| Row1 | a | b |',
        ].join('\n');

        const blocks = parseMarkdown(md);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
            type: 'table',
            headers: [spans(''), spans('Header1'), spans('Header2')],
            rows: [[spans('Row1'), spans('a'), spans('b')]],
        });
    });

    it('handles blank lines and empty first cell combined', () => {
        const md = [
            '### Comparison',
            '',
            '| | Plan A | Plan B |',
            '',
            '|--|----|----|',
            '',
            '| Price | $10/mo | $20/mo |',
            '',
            '| Storage | 5 GB | 50 GB |',
            '',
            '| Support | Email only | 24/7 chat |',
        ].join('\n');

        const blocks = parseMarkdown(md);
        const tableBlocks = blocks.filter(b => b.type === 'table');
        expect(tableBlocks).toHaveLength(1);

        const table = tableBlocks[0];
        if (table.type !== 'table') throw new Error('not a table');

        // Empty first cell should be preserved
        expect(table.headers).toHaveLength(3);
        expect(table.headers[0]).toEqual([]);

        expect(table.rows).toHaveLength(3);
        expect(table.rows[0][0]).toEqual(spans('Price'));
    });

    it('stops table collection at non-blank, non-pipe lines', () => {
        const md = [
            '| A | B |',
            '|---|---|',
            '| 1 | 2 |',
            '',
            'Some text after the table',
        ].join('\n');

        const blocks = parseMarkdown(md);
        const tableBlocks = blocks.filter(b => b.type === 'table');
        const textBlocks = blocks.filter(b => b.type === 'text');

        expect(tableBlocks).toHaveLength(1);
        expect(textBlocks).toHaveLength(1);
    });

    it('parses tagged happy ota preview blocks into a dedicated markdown block', () => {
        const md = [
            '<happy-ota-preview>',
            'title: Settings preview ready',
            'channel: preview',
            'platform: android',
            'runtimeVersion: 21',
            'updateId: 37fdee5f-0417-b135-d7aa-248634dccd37',
            'manifestUrl: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/1751600000000.json',
            '</happy-ota-preview>',
        ].join('\n');

        const blocks = parseMarkdown(md);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('ota-preview');
        if (blocks[0].type !== 'ota-preview') throw new Error('not an ota preview block');
        expect(blocks[0].preview.title).toBe('Settings preview ready');
        expect(blocks[0].preview.channel).toBe('preview');
        expect(blocks[0].preview.stamp).toBe('1751600000000');
    });

    it('parses legacy ota preview field groups into a dedicated markdown block', () => {
        const md = [
            '• Channel: preview',
            '• Platform: android',
            '• runtimeVersion: 21',
            '• Update ID: 37fdee5f-0417-b135-d7aa-248634dccd37',
            '• Manifest: https://happy-app-ota-jacky.oss-cn-hangzhou.aliyuncs.com/manifests/android/21/preview/latest.json',
        ].join('\n');

        const blocks = parseMarkdown(md);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].type).toBe('ota-preview');
        if (blocks[0].type !== 'ota-preview') throw new Error('not an ota preview block');
        expect(blocks[0].preview.source).toBe('legacy');
        expect(blocks[0].preview.channel).toBe('preview');
        expect(blocks[0].preview.platform).toBe('android');
        expect(blocks[0].preview.manifestUrl).toContain('/preview/latest.json');
    });
});
