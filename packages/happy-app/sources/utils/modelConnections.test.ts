import { describe, expect, it } from 'vitest';
import { buildConnectionModelOptions, connectionModelKey, sameCodexConnection } from './modelConnections';
import type { Session } from '@/sync/storageTypes';
const account = { type: 'account' as const, profileId: 'work' };
const native = { type: 'native' as const };
const session = (id: string, profile: string | null, code: string, machineId = 'mini') => ({ id, activeAt: 1,
    metadata: { machineId, flavor: 'codex', ...(profile ? { codexAccountProfileId: profile } : {}), models: [{ code, value: code }] } }) as Session;
const base = { machineId: 'mini', sessions: [], profiles: [{ id: 'work', displayName: 'Work', status: 'available' }],
    currentConnection: account, currentModels: [{ key: 'gpt-6.1-sol', name: 'Sol' }], nativeModels: [], nativeLabel: 'Native', automaticLabel: 'Automatic' };
describe('connection-qualified models', () => {
    it('keeps the exact same model on two connections distinct', () => {
        const result = buildConnectionModelOptions({ ...base, nativeModels: [{ key: 'gpt-6.1-sol', name: 'Sol' }] });
        expect(result).toHaveLength(2);
        expect(new Set(result.map(x => x.key)).size).toBe(2);
        expect(result.map(x => x.modelKey)).toEqual(['gpt-6.1-sol', 'gpt-6.1-sol']);
        expect(result[1].name).toContain('Native');
    });
    it('never borrows another profile or machine catalog', () => {
        const result = buildConnectionModelOptions({ ...base, currentConnection: native, currentModels: [], sessions: [
            session('other', 'other', 'wrong-profile'), session('foreign-machine', 'work', 'wrong-machine', 'air'),
        ] });
        expect(result.find(x => x.connection.type === 'account')?.modelKey).toBe('default');
        expect(JSON.stringify(result)).not.toMatch(/wrong-/);
    });
    it('uses the native runtime catalog without lowercasing provider model IDs', () => {
        const id = 'deepseek/DeepSeek-V4.1-Flash';
        const result = buildConnectionModelOptions({ ...base, nativeModels: [{ key: id, name: id }] });
        expect(result.some(x => x.modelKey === id && x.connection.type === 'native')).toBe(true);
    });
    it('uses a matching owned profile snapshot and omits unavailable profiles', () => {
        const result = buildConnectionModelOptions({ ...base, currentConnection: native, currentModels: [],
            sessions: [session('work', 'work', 'official')], profiles: [...base.profiles, { id: 'bad', displayName: 'Bad', status: 'invalid' }] });
        expect(result.filter(x => x.connection.type === 'account').map(x => x.modelKey)).toEqual(['official']);
    });
    it('keeps keys stable across list reordering and compares connections by profile', () => {
        expect(connectionModelKey(account, 'a::b')).toBe(connectionModelKey({ ...account }, 'a::b'));
        expect(sameCodexConnection(account, native)).toBe(false);
        expect(sameCodexConnection(account, { type: 'account', profileId: 'other' })).toBe(false);
        expect(sameCodexConnection(native, native)).toBe(true);
    });
});
