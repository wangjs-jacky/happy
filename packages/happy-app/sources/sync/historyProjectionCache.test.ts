import { describe, expect, it } from 'vitest';
import type { ApiMessage } from './apiTypes';
import type { NormalizedMessage } from './typesRaw';
import { HistoryProjectionCache } from './historyProjectionCache';
import { createReducer, reducer } from './reducer/reducer';

const wire = (id = 'wire-1'): ApiMessage => ({
    id, seq: 1, createdAt: 10, updatedAt: 20, localId: null,
    content: { t: 'encrypted', c: 'ciphertext' },
});
const normalized = (id = 'wire-1', text = 'Prompt'): NormalizedMessage => ({
    id, localId: null, createdAt: 10, role: 'user', isSidechain: false,
    content: { type: 'text', text },
});
function freezeDeep<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) freezeDeep(child);
    }
    return value;
}

describe('history projection cache', () => {
    it('reuses normalized inputs across reconstructed IndexedDB wire objects and caches invisible records', () => {
        const cache = new HistoryProjectionCache();
        const raw = wire(); const value = normalized();
        expect(cache.get(raw)).toBeUndefined();
        cache.set(raw, value);
        expect(cache.get(structuredClone(raw))).toBe(value);
        cache.set(wire('invisible'), null);
        expect(cache.get(wire('invisible'))).toBeNull();
    });

    it.each(['id', 'seq', 'createdAt', 'updatedAt', 'localId', 'ciphertext'] as const)(
        'never reuses stale normalization after a %s change', field => {
            const cache = new HistoryProjectionCache(); const raw = wire();
            cache.set(raw, normalized());
            if (field === 'ciphertext') raw.content.c = 'changed ciphertext';
            else if (field === 'id' || field === 'localId') raw[field] = 'changed';
            else raw[field] += 1;
            expect(cache.get(raw)).toBeUndefined();
        },
    );

    it('bounds entries using recency and releases retained payloads when the window is retired', () => {
        const cache = new HistoryProjectionCache(2);
        cache.set(wire('a'), normalized('a'));
        cache.set(wire('b'), normalized('b'));
        cache.get(wire('a'));
        cache.set(wire('c'), normalized('c'));
        expect(cache.get(wire('b'))).toBeUndefined();
        expect(cache.get(wire('a'))).toBeDefined();
        cache.retain(new Set(['c']));
        expect(cache.get(wire('a'))).toBeUndefined();
        expect(cache.get(wire('c'))).toBeDefined();
        cache.clear();
        expect(cache.get(wire('c'))).toBeUndefined();
    });

    it('bounds bytes independently of count, including normalized tool/text payloads', () => {
        const cache = new HistoryProjectionCache(500, 1200);
        cache.set(wire('a'), normalized('a', 'x'.repeat(100)));
        cache.set(wire('b'), normalized('b', 'x'.repeat(100)));
        expect(cache.get(wire('a'))).toBeUndefined();
        expect(cache.get(wire('b'))).toBeDefined();
        const oversized = wire('b'); oversized.content.c = 'new';
        cache.set(oversized, normalized('b', 'x'.repeat(3000)));
        expect(cache.get(oversized)).toBeUndefined();
        expect(cache.get(wire('b'))).toBeUndefined();
        cache.set(wire('small'), normalized('small'));
        expect(cache.get(wire('small'))).toBeDefined();
    });

    it('replays frozen cached user, tool-update/result and agent messages through the actual reducer', () => {
        const messages: NormalizedMessage[] = [normalized(), {
            id: 'call', localId: null, createdAt: 11, role: 'agent', isSidechain: false,
            content: [{ type: 'tool-call', id: 'bash-1', name: 'Bash', input: { command: 'ls', nested: { keep: true } },
                description: null, uuid: 'call', parentUUID: null }],
        }, {
            id: 'patch', localId: null, createdAt: 12, role: 'agent', isSidechain: false,
            content: [{ type: 'tool-call', id: 'bash-1', name: 'Bash', input: { timeout: 100 },
                description: null, uuid: 'patch', parentUUID: null }],
        }, {
            id: 'result', localId: null, createdAt: 13, role: 'agent', isSidechain: false,
            content: [{ type: 'tool-result', tool_use_id: 'bash-1', content: { output: 'done' }, is_error: false,
                uuid: 'result', parentUUID: null }],
        }, {
            id: 'answer', localId: null, createdAt: 14, role: 'agent', isSidechain: false,
            content: [{ type: 'text', text: 'Done', uuid: 'answer', parentUUID: null }],
            usage: { input_tokens: 10, output_tokens: 5 },
        }];
        const before = structuredClone(messages);
        const cache = new HistoryProjectionCache();
        for (const message of messages) cache.set(wire(message.id), freezeDeep(message));
        const cached = messages.map(message => cache.get(wire(message.id))!);
        for (let replay = 0; replay < 2; replay++) {
            const result = reducer(createReducer(), cached);
            expect(result.messages).toHaveLength(3);
            expect(result.messages.find(message => message.kind === 'tool-call')).toMatchObject({
                tool: { state: 'completed', input: { command: 'ls', timeout: 100 }, result: { output: 'done' } },
            });
        }
        expect(messages).toEqual(before);
    });
});
