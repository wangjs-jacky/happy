import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Execute the shipped document-start collector without operating a browser.
const expression = execFileSync(process.execPath, [
    fileURLToPath(new URL('../../scripts/check-session-critical-path.mjs', import.meta.url)),
    '--origin', 'https://example.test', '--session-id', 'test-session', '--mode', 'print-phase-2-ego-probe',
], { encoding: 'utf8' });

export function installPhase2Probe(kind: 'deep-link' | 'spawn', options: { mountsRoute?: boolean } = {}) {
    let time = 1;
    const context = {
        URL,
        document: { readyState: 'loading', scripts: [], baseURI: 'https://example.test/' },
        fetch: async () => ({}),
        XMLHttpRequest: class { open() {} send() {} },
        PerformanceObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
        performance: { now: () => time++, getEntriesByType: (type: string) => type === 'navigation' ? [{ startTime: 0 }] : [] },
    };
    const probe = vm.runInNewContext(expression, context);
    (globalThis as any).__happySessionCriticalPathProbe = probe;
    probe.configureSample({ kind, cache: 'cold' });
    if (kind === 'deep-link') {
        probe.initFreshDeepLink();
        for (const stage of ['web.fonts.critical_ready', 'web.crypto.ready', 'web.credentials.ready', 'web.route.mounted']) {
            if (options.mountsRoute && stage === 'web.route.mounted') continue;
            probe.markAppStage(stage);
        }
    }
    return probe;
}
