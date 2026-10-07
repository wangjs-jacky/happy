import { CryptoDigestAlgorithm, digest } from 'expo-crypto';

/** Match the daemon's purpose-separated raw NaCl private key, not a box seed. */
export async function serviceMachineKey(machineKey: Uint8Array): Promise<Uint8Array> {
    const prefix = new TextEncoder().encode('paws-ai-services-machine-box/1\0');
    const input = new Uint8Array(prefix.length + machineKey.length);
    input.set(prefix); input.set(machineKey, prefix.length);
    try { return new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, input)); }
    finally { input.fill(0); }
}
