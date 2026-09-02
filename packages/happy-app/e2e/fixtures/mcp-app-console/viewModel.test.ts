import { describe, expect, it } from 'vitest';
import { toReadinessViewModel } from './src/viewModel.js';

describe('release-readiness MCP App view model', () => {
    it('turns partial readiness structured content into an attention state with check rows', () => {
        expect(toReadinessViewModel({
            releaseName: 'Paws MCP Apps PR 1',
            passed: 3,
            total: 4,
            percent: 75,
            status: 'needs-attention',
            checks: [
                { name: 'Protocol metadata preserved', passed: true },
                { name: 'Structured content preserved', passed: true },
                { name: 'UI resource reachable', passed: true },
                { name: 'Happy Web host available', passed: false },
            ],
        })).toEqual({
            title: 'Paws MCP Apps PR 1',
            eyebrow: 'MCP App · live tool result',
            score: '3 / 4',
            percentText: '75%',
            statusLabel: 'Needs attention',
            statusTone: 'warning',
            rows: [
                { label: 'Protocol metadata preserved', marker: 'Passed', tone: 'success' },
                { label: 'Structured content preserved', marker: 'Passed', tone: 'success' },
                { label: 'UI resource reachable', marker: 'Passed', tone: 'success' },
                { label: 'Happy Web host available', marker: 'Pending', tone: 'warning' },
            ],
        });
    });
});
