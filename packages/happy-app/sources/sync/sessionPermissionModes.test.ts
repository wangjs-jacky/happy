import { describe, expect, it } from 'vitest';
import {
    collectPersistedSessionPermissionModes,
    normalizeSavedSessionPermissionMode,
    resolveRestoredSessionPermissionMode,
} from './sessionPermissionModes';

describe('session permission mode persistence', () => {
    it('drops legacy saved default values so OTA reloads fall back to agent defaults', () => {
        expect(normalizeSavedSessionPermissionMode('default')).toBeNull();
    });

    it('preserves an in-memory default choice when no durable saved override exists', () => {
        expect(resolveRestoredSessionPermissionMode({
            existingPermissionMode: 'default',
            savedPermissionMode: null,
            incomingPermissionMode: null,
        })).toBe('default');
    });

    it('lets a durable saved override replace a stale in-memory default', () => {
        expect(resolveRestoredSessionPermissionMode({
            existingPermissionMode: 'default',
            savedPermissionMode: 'yolo',
            incomingPermissionMode: null,
        })).toBe('yolo');
    });

    it('does not persist default session modes', () => {
        expect(collectPersistedSessionPermissionModes({
            a: { permissionMode: 'default' },
            b: { permissionMode: 'yolo' },
            c: { permissionMode: null },
        })).toEqual({ b: 'yolo' });
    });
});
