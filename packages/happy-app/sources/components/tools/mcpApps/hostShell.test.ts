// @vitest-environment jsdom

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    MCP_APP_MAX_BRIDGE_MESSAGE_BYTES,
    MCP_APP_MAX_FRAME_HEIGHT,
    MCP_APP_MIN_FRAME_HEIGHT,
    createResizeEmitter,
    createSandboxedIframe,
    hostCommandSchema,
    nativeMessages,
    parseHostCommand,
} from '../../../../mcp-app-sandbox/hostShell';
import { MCP_APP_HOST_SHELL_HTML } from './generated/hostShellBundle';

const context = {
    theme: 'light' as const,
    locale: 'en',
    platform: 'android' as const,
    touch: true,
    hover: false,
    container: { width: 390, height: 640 },
    safeAreaInsets: { top: 24, right: 0, bottom: 16, left: 0 },
    displayMode: 'inline' as const,
};

describe('MCP App Host Shell protocol', () => {
    it('accepts only the reviewed native command variants and rejects generic eval', () => {
        const commands = [
            { type: 'mount', instanceId: 'frame-1', html: '<main>safe</main>', context },
            { type: 'tool-input', instanceId: 'frame-1', input: { city: 'Hangzhou' } },
            { type: 'tool-result', instanceId: 'frame-1', result: { content: [] } },
            { type: 'tool-cancelled', instanceId: 'frame-1', reason: 'Stopped' },
            { type: 'host-context', instanceId: 'frame-1', context },
            { type: 'teardown', instanceId: 'frame-1' },
        ];

        for (const command of commands) {
            expect(hostCommandSchema.safeParse(command).success).toBe(true);
        }
        expect(hostCommandSchema.safeParse({ type: 'eval', code: 'window.top.document' }).success).toBe(false);
        expect(hostCommandSchema.safeParse({ ...commands[1], nativeMethod: 'clipboard' }).success).toBe(false);
    });

    it('accepts only bounded shell events and tears down malformed or oversized input', () => {
        for (const message of [
            { type: 'sandbox-ready', instanceId: 'frame-1' },
            { type: 'initialized', instanceId: 'frame-1' },
            { type: 'resize', instanceId: 'frame-1', height: 320 },
            { type: 'teardown-complete', instanceId: 'frame-1' },
            { type: 'protocol-error', instanceId: 'frame-1' },
        ]) {
            expect(nativeMessages.safeParse(message).success).toBe(true);
        }
        expect(nativeMessages.safeParse({ type: 'open-native', method: 'clipboard' }).success).toBe(false);
        expect(() => parseHostCommand('{broken-json')).toThrow();
        expect(() => parseHostCommand('x'.repeat(MCP_APP_MAX_BRIDGE_MESSAGE_BYTES + 1))).toThrow();
    });

    it('creates one opaque-origin iframe with scripts as its only sandbox capability', () => {
        const iframe = createSandboxedIframe(document, '<button>View</button>');

        expect(iframe.getAttribute('sandbox')?.split(/\s+/)).toEqual(['allow-scripts']);
        expect(iframe.getAttribute('allow')).toBe("camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
        expect(iframe.srcdoc).toContain('<button>View</button>');
        expect(Object.keys(iframe.dataset)).toEqual([]);
    });

    it('coalesces resize events to one animation frame and clamps unsafe heights', () => {
        const callbacks: FrameRequestCallback[] = [];
        const requestFrame = vi.fn((callback: FrameRequestCallback) => {
            callbacks.push(callback);
            return callbacks.length;
        });
        const emitted: number[] = [];
        const emit = createResizeEmitter((height) => emitted.push(height), requestFrame);

        emit(-10);
        emit(240);
        emit(Number.POSITIVE_INFINITY);
        emit(50_000);
        expect(requestFrame).toHaveBeenCalledTimes(1);
        expect(emitted).toEqual([]);

        callbacks[0](0);
        expect(emitted).toEqual([MCP_APP_MAX_FRAME_HEIGHT]);

        emit(0);
        callbacks[1](16);
        expect(emitted).toEqual([MCP_APP_MAX_FRAME_HEIGHT, MCP_APP_MIN_FRAME_HEIGHT]);
    });

    it('commits the deterministic minified IIFE generated from the official AppBridge entry', () => {
        expect(MCP_APP_HOST_SHELL_HTML).toContain('<!doctype html>');
        expect(MCP_APP_HOST_SHELL_HTML).not.toMatch(/\bimport\s|sourceMappingURL/);
        expect(MCP_APP_HOST_SHELL_HTML.length).toBeGreaterThan(1_000);

        execFileSync(process.execPath, [
            resolve(process.cwd(), 'scripts/build-mcp-app-host-shell.cjs'),
            '--check',
        ], { cwd: process.cwd(), stdio: 'pipe' });
    });
});
