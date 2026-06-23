import { describe, it, expect } from 'vitest';
import tweetnacl from 'tweetnacl';
import { encryptBlob, decryptBlob, getRandomBytes } from './encryption';

describe('decryptBlob', () => {
    it('decrypts a blob encrypted with NaCl secretbox', () => {
        const key = getRandomBytes(32);
        const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength);
        const ciphertext = tweetnacl.secretbox(plaintext, nonce, key);

        // Wire format: nonce + ciphertext
        const bundle = new Uint8Array(nonce.length + ciphertext.length);
        bundle.set(nonce, 0);
        bundle.set(ciphertext, nonce.length);

        const decrypted = decryptBlob(bundle, key);
        expect(decrypted).not.toBeNull();
        expect(decrypted).toEqual(plaintext);
    });

    it('returns null for wrong key', () => {
        const key = getRandomBytes(32);
        const wrongKey = getRandomBytes(32);
        const plaintext = new Uint8Array([10, 20, 30]);
        const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength);
        const ciphertext = tweetnacl.secretbox(plaintext, nonce, key);

        const bundle = new Uint8Array(nonce.length + ciphertext.length);
        bundle.set(nonce, 0);
        bundle.set(ciphertext, nonce.length);

        expect(decryptBlob(bundle, wrongKey)).toBeNull();
    });

    it('returns null for truncated bundle', () => {
        const key = getRandomBytes(32);
        const tooShort = new Uint8Array(10); // Less than nonce (24) + auth tag (16)
        expect(decryptBlob(tooShort, key)).toBeNull();
    });

    it('round-trips binary data of various sizes', () => {
        const key = getRandomBytes(32);
        for (const size of [0, 1, 255, 1024, 65536]) {
            const data = getRandomBytes(size);
            const nonce = getRandomBytes(tweetnacl.secretbox.nonceLength);
            const encrypted = tweetnacl.secretbox(data, nonce, key);
            const bundle = new Uint8Array(nonce.length + encrypted.length);
            bundle.set(nonce, 0);
            bundle.set(encrypted, nonce.length);

            const decrypted = decryptBlob(bundle, key);
            expect(decrypted).toEqual(data);
        }
    });
});

describe('encryptBlob', () => {
  it('round-trips with decryptBlob', () => {
    const key = getRandomBytes(32);
    const data = new Uint8Array([1, 2, 3, 4, 5, 250, 0, 99]);
    const bundle = encryptBlob(data, key);
    expect(bundle.length).toBeGreaterThanOrEqual(24 + data.length + 16);
    const out = decryptBlob(bundle, key);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(data));
  });

  it('fails to decrypt with a wrong key', () => {
    const data = new Uint8Array([9, 9, 9]);
    const bundle = encryptBlob(data, getRandomBytes(32));
    expect(decryptBlob(bundle, getRandomBytes(32))).toBeNull();
  });
});
