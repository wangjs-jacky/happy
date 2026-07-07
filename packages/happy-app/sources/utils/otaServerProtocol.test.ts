import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type TargetDirective = {
    mode: 'locked' | 'latest';
    stamp: string | null;
    generation: string;
};

type OtaServerProtocolExports = {
    parseTargetDirective: (header: string | null | undefined, now?: () => number) => TargetDirective | null;
    createVirtualManifest: (manifest: Record<string, any>, directive: TargetDirective) => Record<string, any>;
};

function loadOtaServerProtocol(): OtaServerProtocolExports {
    const indexPath = path.resolve(__dirname, '../../ota-server/code/index.js');
    const source = fs.readFileSync(indexPath, 'utf8');
    const module = { exports: {} };
    const sandbox = {
        module,
        exports: module.exports,
        Buffer,
        process: { env: {} },
        console,
        fetch: vi.fn(),
        require: (id: string) => {
            if (id === 'http') {
                return { createServer: () => ({ listen: vi.fn() }) };
            }
            if (id === 'crypto') {
                return require('node:crypto');
            }
            return require(id);
        },
    };

    vm.runInNewContext(`${source}\nmodule.exports = { parseTargetDirective, createVirtualManifest };`, sandbox);
    return module.exports as OtaServerProtocolExports;
}

describe('ota-server target protocol', () => {
    it('parses locked target stamp and stable generation from Expo extra params', () => {
        const { parseTargetDirective } = loadOtaServerProtocol();

        expect(parseTargetDirective(
            'ota-target-stamp="1783446350184", ota-target-generation="1783449000000"',
        )).toEqual({
            mode: 'locked',
            stamp: '1783446350184',
            generation: '1783449000000',
        });
    });

    it('parses latest target mode for unlocking preview back to latest', () => {
        const { parseTargetDirective } = loadOtaServerProtocol();

        expect(parseTargetDirective(
            'ota-target-stamp="latest", ota-target-generation="1783449000001"',
        )).toEqual({
            mode: 'latest',
            stamp: null,
            generation: '1783449000001',
        });
    });

    it('uses a deterministic legacy generation when old clients omit it', () => {
        const { parseTargetDirective } = loadOtaServerProtocol();

        expect(parseTargetDirective('ota-target-stamp="1783446350184"', () => 1783449000000)).toEqual({
            mode: 'locked',
            stamp: '1783446350184',
            generation: '1783446350184',
        });
    });

    it('wraps a real manifest as a virtual target update', () => {
        const { createVirtualManifest } = loadOtaServerProtocol();
        const manifest = {
            id: 'ffd76178-aa38-f8fd-b741-8c511428c472',
            createdAt: '2026-07-07T17:45:50.184Z',
            metadata: { existing: 'value' },
            extra: { git: { sha: 'ca83d46' } },
        };

        const virtual = createVirtualManifest(manifest, {
            mode: 'locked',
            stamp: '1783446350184',
            generation: '1783449000000',
        });

        expect(virtual.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(virtual.id).not.toBe(manifest.id);
        expect(virtual.createdAt).toBe('2026-07-07T18:30:00.000Z');
        expect(virtual.metadata).toMatchObject({
            existing: 'value',
            'happy-ota-mode': 'locked',
            'happy-ota-target-stamp': '1783446350184',
            'happy-ota-generation': '1783449000000',
            'happy-ota-original-id': manifest.id,
        });
        expect(virtual.extra).toMatchObject({
            git: { sha: 'ca83d46' },
            otaTarget: {
                mode: 'locked',
                stamp: '1783446350184',
                generation: '1783449000000',
                originalUpdateId: manifest.id,
                virtualUpdateId: virtual.id,
            },
        });
    });
});
