import { expect, type Frame, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export type McpAppE2eEnvironment = {
    authenticatedWebUrl: string;
    webOrigin: string;
    sandboxOrigin: string;
    sessionId: string;
};

export type McpAppFrames = { proxy: Frame; view: Frame };

function requiredEnvironment(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required ${name} for MCP App real-origin E2E`);
    return value;
}

function exactOrigin(raw: string, label: string): string {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error(`${label} must be an absolute URL`); }
    const loopbackHttp = url.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !loopbackHttp) || url.username || url.password || !url.hostname) {
        throw new Error(`${label} must be an HTTP(S) URL without credentials`);
    }
    return url.origin;
}

export function requireMcpAppE2eEnvironment(): McpAppE2eEnvironment {
    const authenticatedWebUrl = requiredEnvironment('HAPPY_E2E_WEB_URL');
    const sandboxRaw = requiredEnvironment('HAPPY_MCP_APP_SANDBOX_ORIGIN');
    const sessionId = requiredEnvironment('HAPPY_MCP_APP_E2E_SESSION_ID');
    const webOrigin = exactOrigin(authenticatedWebUrl, 'HAPPY_E2E_WEB_URL');
    const sandboxOrigin = exactOrigin(sandboxRaw, 'HAPPY_MCP_APP_SANDBOX_ORIGIN');
    if (sandboxRaw !== sandboxOrigin && sandboxRaw !== `${sandboxOrigin}/`) {
        throw new Error('HAPPY_MCP_APP_SANDBOX_ORIGIN must be an exact origin');
    }
    if (sandboxOrigin === webOrigin) throw new Error('MCP App sandbox origin must differ from the Paws Web origin');
    if (!/^[A-Za-z0-9_-]{1,256}$/u.test(sessionId)) throw new Error('HAPPY_MCP_APP_E2E_SESSION_ID is invalid');
    return { authenticatedWebUrl, webOrigin, sandboxOrigin, sessionId };
}

export function sessionUrl(environment: McpAppE2eEnvironment): string {
    const url = new URL(environment.authenticatedWebUrl);
    url.pathname = `/session/${encodeURIComponent(environment.sessionId)}`;
    return url.toString();
}

export async function findMcpAppFrames(page: Page, sandboxOrigin: string): Promise<McpAppFrames> {
    let result: McpAppFrames | undefined;
    await expect.poll(async () => {
        const proxies = page.frames().filter((frame) => {
            try {
                return new URL(frame.url()).origin === sandboxOrigin
                    && frame.parentFrame() === page.mainFrame();
            } catch {
                return false;
            }
        });
        if (proxies.length !== 1) return false;
        const children = proxies[0].childFrames();
        if (children.length !== 1 || children[0].url() !== 'about:srcdoc') return false;
        result = { proxy: proxies[0], view: children[0] };
        return true;
    }, { timeout: 30_000, message: 'expected one exact-origin Proxy with one inner MCP View' }).toBe(true);

    const outer = page.locator('iframe[data-testid="mcp-app-sandbox-frame"]');
    await expect(outer).toHaveCount(1);
    const src = await outer.getAttribute('src');
    expect(src && new URL(src).origin).toBe(sandboxOrigin);
    await expect(outer).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    await expect(outer).toHaveAttribute('referrerpolicy', 'origin');

    const proxyState = await result!.proxy.evaluate(() => ({
        origin: window.location.origin,
        referrer: document.referrer,
        innerCount: document.querySelectorAll('iframe').length,
    }));
    expect(proxyState.origin).toBe(sandboxOrigin);
    expect(new URL(proxyState.referrer).origin).toBe(new URL(page.url()).origin);
    expect(proxyState.innerCount).toBe(1);
    const inner = result!.proxy.locator('iframe');
    await expect(inner).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(inner).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(await inner.getAttribute('srcdoc')).toBeTruthy();
    expect(await result!.view.evaluate(() => window.origin)).toBe('null');
    return result!;
}

export async function injectUnexpectedSourceMessage(page: Page, sandboxOrigin: string): Promise<void> {
    const attackerName = 'mcp-app-unexpected-source';
    await page.evaluate(({ attackerName }) => {
        document.querySelector(`iframe[name="${attackerName}"]`)?.remove();
        const attacker = document.createElement('iframe');
        attacker.name = attackerName;
        attacker.hidden = true;
        attacker.srcdoc = '<!doctype html><title>unexpected source</title>';
        document.body.append(attacker);
    }, { attackerName });
    try {
        let attacker: Frame | undefined;
        await expect.poll(() => {
            attacker = page.frames().find((frame) => frame.name() === attackerName);
            return Boolean(attacker);
        }, { message: 'unexpected-source attacker frame did not load' }).toBe(true);
        await attacker!.evaluate(({ sandboxOrigin }) => {
            const target = parent.document.querySelector<HTMLIFrameElement>('iframe[data-testid="mcp-app-sandbox-frame"]')?.contentWindow;
            if (!target) throw new Error('MCP App Proxy WindowProxy is unavailable');
            target.postMessage(JSON.stringify({
                type: 'sandbox-proxy-ready',
                parentOrigin: parent.location.origin,
            }), sandboxOrigin);
        }, { sandboxOrigin });
    } finally {
        await page.evaluate(({ attackerName }) => {
            document.querySelector(`iframe[name="${attackerName}"]`)?.remove();
        }, { attackerName });
    }
}

export async function saveMcpAppEvidence(page: Page, testInfo: TestInfo, filename: string): Promise<void> {
    const configured = process.env.HAPPY_MCP_APP_EVIDENCE_DIR;
    const target = configured
        ? path.join(path.resolve(configured), filename)
        : testInfo.outputPath(filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await page.screenshot({ path: target, fullPage: true });
}
