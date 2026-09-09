import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { io } from 'socket.io-client';
import { encodeBase64, encryptLegacy } from '../../happy-cli/src/api/encryption';

const authenticatedWebUrl = process.env.HAPPY_E2E_WEB_URL!;
const e2eServerUrl = process.env.HAPPY_E2E_SERVER_URL!;

function authConfig(): { token: string; secret: Uint8Array } {
    const url = new URL(authenticatedWebUrl);
    const token = url.searchParams.get('dev_token');
    const secret = url.searchParams.get('dev_secret');
    if (!token || !secret || !e2eServerUrl) throw new Error('缺少 Web 自动跟随 E2E 的认证配置。');
    return { token, secret: new Uint8Array(Buffer.from(secret, 'base64url')) };
}

type TranscriptEnvelope = {
    id: string;
    time: number;
    role: 'agent' | 'user';
    turn: string;
    ev: { t: 'text'; text: string };
};

async function createSession(request: APIRequestContext): Promise<string> {
    const { token, secret } = authConfig();
    const metadata = encodeBase64(encryptLegacy({
        path: '/workspace/web-auto-scroll-e2e',
        host: 'web-auto-scroll-e2e',
        name: 'PC Web transcript auto-scroll E2E',
        flavor: 'codex',
        lifecycleState: 'running',
        startedBy: 'terminal',
    }, secret));
    const response = await request.post(new URL('/v1/sessions', e2eServerUrl).toString(), {
        data: {
            tag: `web-auto-scroll-e2e-${Date.now()}-${Math.random()}`,
            metadata,
            agentState: null,
            dataEncryptionKey: null,
        },
        headers: { Authorization: `Bearer ${token}`, 'X-Happy-Client': 'web-auto-scroll-e2e' },
    });
    expect(response.ok()).toBe(true);
    return ((await response.json()) as { session: { id: string } }).session.id;
}

async function appendEnvelopes(request: APIRequestContext, sessionId: string, envelopes: TranscriptEnvelope[]): Promise<void> {
    const { token, secret } = authConfig();
    const response = await request.post(
        new URL(`/v3/sessions/${encodeURIComponent(sessionId)}/messages`, e2eServerUrl).toString(),
        {
            data: {
                messages: envelopes.map((envelope, index) => ({
                    content: encodeBase64(encryptLegacy({ role: 'session', content: envelope }, secret)),
                    localId: `web-auto-scroll-envelope-${Date.now()}-${index}-${Math.random()}`,
                })),
            },
            headers: { Authorization: `Bearer ${token}`, 'X-Happy-Client': 'web-auto-scroll-e2e' },
        },
    );
    expect(response.ok()).toBe(true);
}

async function connectSessionAgent(sessionId: string): Promise<() => void> {
    const { token } = authConfig();
    const socket = io(e2eServerUrl, {
        auth: { token, clientType: 'session-scoped', sessionId, happyClient: 'web-auto-scroll-e2e' },
        autoConnect: false,
        path: '/v1/updates',
        reconnection: false,
        transports: ['websocket'],
    });
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Web 自动跟随 E2E Agent 连接超时。')), 10_000);
        socket.once('connect_error', (error: Error) => { clearTimeout(timeout); reject(error); });
        socket.once('connect', () => { clearTimeout(timeout); resolve(); });
        socket.connect();
    });
    const pulse = () => socket.emit('session-alive', { sid: sessionId, time: Date.now(), thinking: true });
    pulse();
    const keepAlive = setInterval(pulse, 500);
    return () => { clearInterval(keepAlive); socket.close(); };
}

async function transcriptGeometry(page: Page): Promise<{ scrollTop: number; maxScroll: number; distanceFromBottom: number }> {
    return page.getByTestId('conversation-transcript-list').evaluate((element) => {
        const node = element as HTMLElement;
        const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);
        return { scrollTop: node.scrollTop, maxScroll, distanceFromBottom: Math.max(0, maxScroll - node.scrollTop) };
    });
}

async function userWheelTranscript(page: Page, deltaY: number): Promise<void> {
    const box = await page.getByTestId('conversation-transcript-list').boundingBox();
    if (!box) throw new Error('找不到对话滚动区域。');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, deltaY);
}

function sessionRoute(sessionId: string): string {
    const url = new URL(`/session/${sessionId}`, authenticatedWebUrl);
    return url.toString();
}

test('[CHAT-AUTO-SCROLL] PC Web 发送后跟随流式输出，用户滚动后暂停并回到底部恢复', async ({ page, request }) => {
    test.setTimeout(180_000);
    const sessionId = await createSession(request);
    const now = Date.now() - 120_000;
    const repeatedText = '这是一段用于制造真实长对话布局的历史内容。'.repeat(18);
    await appendEnvelopes(request, sessionId, Array.from({ length: 22 }, (_, index) => {
        const time = now + index * 2_000;
        const turn = `history-turn-${index}`;
        return [
            { id: `${turn}-user`, time, role: 'user' as const, turn, ev: { t: 'text' as const, text: `历史问题 ${index}：${repeatedText}` } },
            { id: `${turn}-agent`, time: time + 1_000, role: 'agent' as const, turn, ev: { t: 'text' as const, text: `历史回答 ${index}：${repeatedText}` } },
        ];
    }).flat());

    let disconnectAgent: (() => void) | null = null;
    try {
        disconnectAgent = await connectSessionAgent(sessionId);
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(sessionRoute(sessionId));
        await expect(page.getByTestId('session-message-input')).toBeVisible({ timeout: 120_000 });
        const transcript = page.getByTestId('conversation-transcript-list');
        await expect(transcript).toBeVisible();
        await expect.poll(async () => {
            const { maxScroll, distanceFromBottom } = await transcriptGeometry(page);
            return maxScroll > 400 && distanceFromBottom < 30;
        }, { timeout: 20_000 }).toBe(true);

        await userWheelTranscript(page, -1_400);
        await expect.poll(async () => {
            const { scrollTop, distanceFromBottom } = await transcriptGeometry(page);
            return scrollTop > 150 && distanceFromBottom > 250;
        }).toBe(true);

        const prompt = `自动跟随滚动发送验证 ${Date.now()}`;
        await page.getByTestId('session-message-input').fill(prompt);
        await page.locator('[data-testid="message-composer-send-button"]:visible').click();
        await expect(page.getByText(prompt, { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect.poll(async () => (await transcriptGeometry(page)).distanceFromBottom < 30, { timeout: 15_000 }).toBe(true);

        const streamTurn = `stream-turn-${Date.now()}`;
        const streamText = '第一段流式输出，用来确认发送后的最新跟随仍然有效。'.repeat(16);
        await appendEnvelopes(request, sessionId, [{
            id: `${streamTurn}-1`, time: Date.now(), role: 'agent', turn: streamTurn,
            ev: { t: 'text', text: streamText },
        }]);
        await expect(page.getByText(streamText, { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect.poll(async () => (await transcriptGeometry(page)).distanceFromBottom < 35, { timeout: 15_000 }).toBe(true);

        await userWheelTranscript(page, -1_000);
        await expect.poll(async () => (await transcriptGeometry(page)).distanceFromBottom > 250).toBe(true);
        const pausedAt = await transcriptGeometry(page);
        const pausedStreamText = '用户滚动后不应被新 token 抢回底部。'.repeat(18);
        await appendEnvelopes(request, sessionId, [{
            id: `${streamTurn}-2`, time: Date.now() + 1, role: 'agent', turn: streamTurn,
            ev: { t: 'text', text: pausedStreamText },
        }]);
        // The latest row may be outside Web's render window while the user
        // is reading older content. Growth plus a stable offset proves that
        // the new output was received without requiring an offscreen row to
        // remain mounted.
        await expect.poll(async () => (await transcriptGeometry(page)).scrollHeight > pausedAt.scrollHeight, { timeout: 15_000 }).toBe(true);
        await expect.poll(async () => Math.abs((await transcriptGeometry(page)).scrollTop - pausedAt.scrollTop) < 80, { timeout: 15_000 }).toBe(true);

        await userWheelTranscript(page, 10_000);
        await expect.poll(async () => (await transcriptGeometry(page)).distanceFromBottom < 30, { timeout: 15_000 }).toBe(true);
        const resumedStreamText = '回到底部后恢复自动跟随。'.repeat(18);
        await appendEnvelopes(request, sessionId, [{
            id: `${streamTurn}-3`, time: Date.now() + 2, role: 'agent', turn: streamTurn,
            ev: { t: 'text', text: resumedStreamText },
        }]);
        await expect(page.getByText(resumedStreamText, { exact: true })).toBeVisible({ timeout: 15_000 });
        await expect.poll(async () => (await transcriptGeometry(page)).distanceFromBottom < 35, { timeout: 15_000 }).toBe(true);
    } finally {
        disconnectAgent?.();
    }
});
