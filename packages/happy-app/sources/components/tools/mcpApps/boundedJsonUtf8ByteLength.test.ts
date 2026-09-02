import { describe, expect, it } from 'vitest';
import { boundedJsonUtf8ByteLength } from './boundedJsonUtf8ByteLength';

describe('boundedJsonUtf8ByteLength', () => {
    it('counts JSON punctuation, omission, null coercion, escapes, and UTF-8 strings', () => {
        expect(boundedJsonUtf8ByteLength({ keep: null, drop: undefined }, {
            maxBytes: 1_024,
        })).toBe(13);
        expect(boundedJsonUtf8ByteLength([undefined, () => {}, Symbol('drop')], {
            maxBytes: 1_024,
        })).toBe(16);
        expect(boundedJsonUtf8ByteLength('"\\\n', { maxBytes: 1_024 })).toBe(8);
        expect(boundedJsonUtf8ByteLength('é😀\ud800', { maxBytes: 1_024 })).toBe(14);
        expect(boundedJsonUtf8ByteLength(Number.NaN, { maxBytes: 1_024 })).toBe(4);
    });

    it('returns unknown for cycles, BigInt, accessors, throwing proxies, and exhausted bounds', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        let getterCalls = 0;
        const getter = Object.defineProperty({}, 'secret', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'must-not-run';
            },
        });
        const throwingProxy = new Proxy({}, {
            ownKeys() {
                throw new Error('proxy trap');
            },
        });

        expect(boundedJsonUtf8ByteLength(cyclic, { maxBytes: 1_024 })).toBeNull();
        expect(boundedJsonUtf8ByteLength(1n, { maxBytes: 1_024 })).toBeNull();
        expect(boundedJsonUtf8ByteLength(getter, { maxBytes: 1_024 })).toBeNull();
        expect(getterCalls).toBe(0);
        expect(boundedJsonUtf8ByteLength(throwingProxy, { maxBytes: 1_024 })).toBeNull();
        expect(boundedJsonUtf8ByteLength([[[['too deep']]]], {
            maxBytes: 1_024,
            maxDepth: 2,
        })).toBeNull();
        expect(boundedJsonUtf8ByteLength([1, 2, 3], {
            maxBytes: 1_024,
            maxNodes: 2,
        })).toBeNull();
    });

    it('caps a huge lazy array without visiting or encoding its full value', () => {
        const target: string[] = [];
        target.length = 1_000_000;
        let elementDescriptorVisits = 0;
        const lazy = new Proxy(target, {
            getOwnPropertyDescriptor(source, property) {
                if (typeof property === 'string' && /^\d+$/.test(property)) {
                    elementDescriptorVisits += 1;
                    return {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: '四'.repeat(1_024),
                    };
                }
                return Reflect.getOwnPropertyDescriptor(source, property);
            },
        });
        const cap = 256 * 1_024 + 1;

        expect(boundedJsonUtf8ByteLength(lazy, {
            maxBytes: cap,
            maxDepth: 32,
            maxNodes: 1_000,
        })).toBe(cap);
        expect(elementDescriptorVisits).toBeGreaterThan(0);
        expect(elementDescriptorVisits).toBeLessThan(100);
    });
});
