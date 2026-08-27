import type { PluginCatalogItem, PluginCatalogResponse } from '@slopus/happy-wire';
import * as React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// @ts-expect-error react-test-renderer has no bundled declarations.
import TestRenderer from 'react-test-renderer';

const syncMocks = vi.hoisted(() => ({
    getPluginCatalog: vi.fn(),
    subscribePluginCatalogChanges: vi.fn(() => () => undefined),
}));

vi.mock('@/sync/plugins', () => syncMocks);

import { usePlugins } from './usePlugins';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function plugin(id: string): PluginCatalogItem {
    return {
        manifest: { id },
        status: { installed: false },
    } as PluginCatalogItem;
}

function Probe() {
    const value = usePlugins();
    return React.createElement('probe', { value });
}

describe('usePlugins', () => {
    const originalConsoleError = console.error;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
            if (values[0] === 'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer') return;
            originalConsoleError(...values);
        });
    });

    afterEach(() => consoleErrorSpy.mockRestore());

    it('ignores an older catalog response that completes after a newer refresh', async () => {
        const older = deferred<PluginCatalogResponse>();
        const newer = deferred<PluginCatalogResponse>();
        syncMocks.getPluginCatalog
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(newer.promise);

        let renderer: any;
        await act(async () => {
            renderer = TestRenderer.create(<Probe />);
        });
        await vi.waitFor(() => expect(syncMocks.getPluginCatalog).toHaveBeenCalledTimes(1));

        let newerRefresh!: Promise<PluginCatalogResponse | null>;
        await act(async () => {
            newerRefresh = renderer.root.findByType('probe').props.value.refresh();
            await Promise.resolve();
        });
        newer.resolve({ plugins: [plugin('newer')] });
        await act(async () => {
            await newerRefresh;
        });
        expect(renderer.root.findByType('probe').props.value.plugins[0].manifest.id).toBe('newer');

        older.resolve({ plugins: [plugin('older')] });
        await act(async () => {
            await older.promise;
        });
        expect(renderer.root.findByType('probe').props.value.plugins[0].manifest.id).toBe('newer');
        act(() => renderer.unmount());
    });
});
