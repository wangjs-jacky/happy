import { encodeBase64, encryptLegacy } from '../../../../happy-cli/src/api/encryption';

export const PREVIEW_FIXTURE_IDS = {
    publishing: '10000000-0000-4000-8000-000000000001',
    ready: '10000000-0000-4000-8000-000000000002',
    failed: '10000000-0000-4000-8000-000000000003',
    expired: '10000000-0000-4000-8000-000000000004',
} as const;

type FixtureEnvelope = {
    id: string;
    time: number;
    role: 'agent';
    turn: string;
    ev: Record<string, unknown>;
};

export function buildVercelPreviewEnvelopes(baseTime = 1_800_000_000_000): FixtureEnvelope[] {
    const turn = 'vercel-preview-e2e-turn';
    const events: FixtureEnvelope[] = [
        {
            id: 'preview-fixture-intro', time: baseTime, role: 'agent', turn,
            ev: { t: 'text', text: 'Managed interaction preview fixture' },
        },
        {
            id: 'preview-publishing', time: baseTime + 1, role: 'agent', turn,
            ev: { t: 'interactive-preview', preview: { version: 1, id: PREVIEW_FIXTURE_IDS.publishing, title: 'Publishing checkout flow', state: 'publishing' } },
        },
        {
            id: 'preview-ready', time: baseTime + 2, role: 'agent', turn,
            ev: { t: 'interactive-preview', preview: { version: 1, id: PREVIEW_FIXTURE_IDS.ready, title: 'Ready checkout flow', state: 'ready', url: 'https://happy-preview.example.invalid/checkout', publishedAt: baseTime, expiresAt: 4_102_444_800_000 } },
        },
        {
            id: 'preview-failed', time: baseTime + 3, role: 'agent', turn,
            ev: { t: 'interactive-preview', preview: { version: 1, id: PREVIEW_FIXTURE_IDS.failed, title: 'Failed checkout flow', state: 'failed', errorCode: 'PREVIEW_PROVIDER_ERROR' } },
        },
        {
            id: 'preview-expired', time: baseTime + 4, role: 'agent', turn,
            ev: { t: 'interactive-preview', preview: { version: 1, id: PREVIEW_FIXTURE_IDS.expired, title: 'Expired checkout flow', state: 'expired', publishedAt: baseTime - 86_400_000, expiresAt: baseTime - 1 } },
        },
    ];

    for (const [runIndex, runId] of ['ego-fixture-run-1', 'ego-fixture-run-2'].entries()) {
        const call = `ego-fixture-call-${runIndex + 1}`;
        events.push({
            id: `${call}-start`, time: baseTime + 100 + runIndex * 100, role: 'agent', turn,
            ev: {
                t: 'tool-call-start', call, name: 'Skill', title: 'Use ego-browser',
                description: `Deterministic Ego run ${runIndex + 1}`,
                args: { skillNames: ['ego-browser'], runId },
            },
        });
        const stepCount = runIndex === 0 ? 12 : 3;
        for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
            events.push({
                id: `${runId}-step-${stepIndex + 1}`,
                time: baseTime + 110 + runIndex * 100 + stepIndex,
                role: 'agent',
                turn,
                ev: {
                    t: 'file',
                    ref: `attachment://${runId}-step-${stepIndex + 1}`,
                    name: `${runId}-step-${stepIndex + 1}.png`,
                    size: 128,
                    source: 'browser_step',
                    browserStep: {
                        label: `Verified browser milestone ${runIndex + 1}.${stepIndex + 1}`,
                        runId,
                        skillName: 'ego-browser',
                    },
                },
            });
        }
        events.push({
            id: `${call}-end`, time: baseTime + 190 + runIndex * 100, role: 'agent', turn,
            ev: { t: 'tool-call-end', call, status: 'completed' },
        });
    }
    return events;
}

function credentials(webUrl: string): { encryptionKey: Uint8Array; token: string } {
    const parsed = new URL(webUrl);
    const token = parsed.searchParams.get('dev_token');
    const secret = parsed.searchParams.get('dev_secret');
    if (!token || !secret) throw new Error('Authenticated E2E Web URL is missing dev credentials.');
    return { token, encryptionKey: new Uint8Array(Buffer.from(secret, 'base64url')) };
}

async function expectOk(response: Response, action: string): Promise<void> {
    if (response.ok) return;
    throw new Error(`${action} failed (${response.status}): ${(await response.text()).slice(0, 280)}`);
}

export async function seedVercelPreviewFixture(options: {
    serverUrl: string;
    webUrl: string;
}): Promise<{ sessionId: string; sessionUrl: string }> {
    const auth = credentials(options.webUrl);
    const metadata = encodeBase64(encryptLegacy({
        path: '/tmp/paws-vercel-preview-e2e',
        homeDir: '/tmp',
        host: 'preview-evidence.local',
        name: 'Vercel preview and Ego progress fixture',
        flavor: 'codex',
        lifecycleState: 'running',
        startedBy: 'terminal',
        skills: ['ego-browser', 'ego-ops', 'dev'],
    }, auth.encryptionKey));
    const headers = {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
        'X-Happy-Client': 'vercel-preview-e2e-fixture',
    };
    const sessionResponse = await fetch(new URL('/v1/sessions', options.serverUrl), {
        method: 'POST', headers,
        body: JSON.stringify({
            tag: `vercel-preview-e2e-${Date.now()}`,
            metadata,
            agentState: null,
            dataEncryptionKey: null,
        }),
    });
    await expectOk(sessionResponse, 'Create fixture session');
    const sessionId = ((await sessionResponse.json()) as { session: { id: string } }).session.id;

    const messages = buildVercelPreviewEnvelopes().map((envelope, index) => ({
        content: encodeBase64(encryptLegacy({ role: 'session', content: envelope }, auth.encryptionKey)),
        localId: `vercel-preview-e2e-${sessionId}-${index}`,
    }));
    const messagesResponse = await fetch(new URL(`/v3/sessions/${encodeURIComponent(sessionId)}/messages`, options.serverUrl), {
        method: 'POST', headers, body: JSON.stringify({ messages }),
    });
    await expectOk(messagesResponse, 'Append fixture messages');

    const sessionUrl = new URL(options.webUrl);
    sessionUrl.pathname = `/session/${sessionId}`;
    return { sessionId, sessionUrl: sessionUrl.toString() };
}
