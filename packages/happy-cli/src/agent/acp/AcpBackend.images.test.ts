import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpBackend } from './AcpBackend';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function start(imageCapability?: boolean, rejectImages = false) {
    const dir = await mkdtemp(join(tmpdir(), 'paws-acp-images-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const requests = join(dir, 'requests.jsonl');
    const script = `
      const fs = require('node:fs');
      require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
        const msg = JSON.parse(line);
        if (msg.id === undefined) return;
        fs.appendFileSync(${JSON.stringify(requests)}, JSON.stringify(msg) + '\\n');
        let result = {};
        if (msg.method === 'initialize') result = {protocolVersion: 1, agentCapabilities: {promptCapabilities: ${JSON.stringify(imageCapability === undefined ? {} : { image: imageCapability })}}};
        if (msg.method === 'session/new') result = {sessionId: 'test-session'};
        if (msg.method === 'session/prompt') {
          if (${rejectImages} && msg.params.prompt.some(p => p.type === 'image')) {
            process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32602,message:'Selected model does not support image input'}})+'\\n'); return;
          }
          result = {stopReason:'end_turn'};
        }
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\\n');
      });`;
    const backend = new AcpBackend({ agentName: 'opencode', cwd: dir, command: process.execPath, args: ['-e', script] });
    cleanups.push(() => backend.dispose());
    await backend.startSession();
    return { backend, prompts: async () => (await readFile(requests, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(r => r.method === 'session/prompt') };
}

const image = { data: new Uint8Array([137, 80, 78, 71]), mimeType: 'image/png', name: 'picture.png' };
describe('ACP image prompt transport', () => {
    it('sends text and exact image bytes through the real ACP connection', async () => {
        const { backend, prompts } = await start(true);
        await backend.sendPrompt('test-session', 'describe this', [image]);
        expect((await prompts())[0].params.prompt).toEqual([
            { type: 'text', text: 'describe this' },
            { type: 'image', data: 'iVBORw==', mimeType: 'image/png' },
        ]);
    });
    it.each([false, undefined])('rejects pictures when image capability is %s while keeping text usable', async capability => {
        const { backend, prompts } = await start(capability);
        await expect(backend.sendPrompt('test-session', 'picture', [image])).rejects.toThrow(/image/i);
        await backend.sendPrompt('test-session', 'text only');
        expect(await prompts()).toHaveLength(1);
        expect((await prompts())[0].params.prompt).toEqual([{ type: 'text', text: 'text only' }]);
    });
    it('preserves a model image rejection and allows a following text request', async () => {
        const { backend, prompts } = await start(true, true);
        await expect(backend.sendPrompt('test-session', 'picture', [image])).rejects.toThrow(/Selected model does not support image input/);
        await backend.sendPrompt('test-session', 'text only');
        expect(await prompts()).toHaveLength(2);
    });
});
