export type ReadinessOutput = {
    releaseName: string;
    passed: number;
    total: number;
    percent: number;
    status: 'ready' | 'needs-attention';
    checks: Array<{ name: string; passed: boolean }>;
};

export type ReadinessViewModel = {
    title: string;
    eyebrow: string;
    score: string;
    percentText: string;
    statusLabel: 'Ready' | 'Needs attention';
    statusTone: 'success' | 'warning';
    rows: Array<{
        label: string;
        marker: 'Passed' | 'Pending';
        tone: 'success' | 'warning';
    }>;
};

export function toReadinessViewModel(output: ReadinessOutput): ReadinessViewModel {
    const ready = output.status === 'ready';
    return {
        title: output.releaseName,
        eyebrow: 'MCP App · live tool result',
        score: `${output.passed} / ${output.total}`,
        percentText: `${output.percent}%`,
        statusLabel: ready ? 'Ready' : 'Needs attention',
        statusTone: ready ? 'success' : 'warning',
        rows: output.checks.map((check) => ({
            label: check.name,
            marker: check.passed ? 'Passed' : 'Pending',
            tone: check.passed ? 'success' : 'warning',
        })),
    };
}
