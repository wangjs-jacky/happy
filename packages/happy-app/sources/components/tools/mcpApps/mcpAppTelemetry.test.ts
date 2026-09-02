import { describe, expect, it, vi } from 'vitest';
import {
    MCP_APP_TELEMETRY_EVENT_NAMES,
    buildMcpAppTelemetry,
    emitMcpAppTelemetry,
} from './mcpAppTelemetry';

describe('MCP App App telemetry', () => {
    it('serializes only bounded allowlisted fields when callers carry canary secrets', () => {
        const payload = buildMcpAppTelemetry({
            platform: 'android',
            stage: 'resource',
            durationMs: 120,
            byteLength: 4_096,
            originScoped: false,
            code: 'MCP_APP_INVALID_RESOURCE',
            uri: 'ui://CANARY_MUST_NOT_APPEAR/index.html',
            connectorId: 'CANARY_MUST_NOT_APPEAR',
            arguments: { secret: 'CANARY_MUST_NOT_APPEAR' },
            result: 'CANARY_MUST_NOT_APPEAR',
            _meta: { secret: 'CANARY_MUST_NOT_APPEAR' },
            html: '<p>CANARY_MUST_NOT_APPEAR</p>',
        } as never);

        expect(payload).toEqual({
            platform: 'android',
            stage: 'resource',
            durationBucket: '100ms_to_999ms',
            byteSizeBucket: '1kb_to_63kb',
            originScoped: false,
            outcomeCode: 'MCP_APP_INVALID_RESOURCE',
        });
        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain('CANARY_MUST_NOT_APPEAR');
        expect(serialized).not.toMatch(/uri|connector|arguments|result|_meta|html/i);
    });

    it('collapses invalid runtime values to bounded safe buckets and outcome', () => {
        expect(buildMcpAppTelemetry({
            platform: 'secret-platform',
            stage: 'secret-stage',
            durationMs: Number.POSITIVE_INFINITY,
            byteLength: -1,
            originScoped: 'yes',
            code: 'CANARY_MUST_NOT_APPEAR',
        } as never)).toEqual({
            platform: 'unknown',
            stage: 'unknown',
            durationBucket: 'unknown',
            byteSizeBucket: 'unknown',
            originScoped: false,
            outcomeCode: 'MCP_APP_INTERNAL',
        });
    });

    it('exposes exactly the five approved product event names', () => {
        expect(MCP_APP_TELEMETRY_EVENT_NAMES).toEqual([
            'mcp_app_render_started',
            'mcp_app_render_succeeded',
            'mcp_app_render_failed',
            'mcp_app_tool_call_requested',
            'mcp_app_tool_call_resolved',
        ]);
    });

    it('keeps sink failures inert', () => {
        const sink = vi.fn(() => { throw new Error('sink failed'); });

        expect(() => emitMcpAppTelemetry('mcp_app_render_started', {
            platform: 'ios',
            stage: 'resource',
            durationMs: 0,
            byteLength: 0,
            originScoped: false,
            code: 'started',
        }, sink)).not.toThrow();
        expect(sink).toHaveBeenCalledTimes(1);
    });

    it('drops unknown runtime event names instead of forwarding them to the sink', () => {
        const sink = vi.fn();

        emitMcpAppTelemetry('CANARY_EVENT_MUST_NOT_APPEAR' as never, {
            platform: 'web',
            stage: 'resource',
            durationMs: 0,
            byteLength: 0,
            originScoped: false,
            code: 'started',
        }, sink);

        expect(sink).not.toHaveBeenCalled();
    });
});
