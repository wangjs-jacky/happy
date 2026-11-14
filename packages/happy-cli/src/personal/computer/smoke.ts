/** Explicit opt-in smoke: no production account, model, daemon or host browser. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersonalComputer } from './index';

async function main() {
    if (process.env.PAWS_COMPUTER_SMOKE !== '1') throw new Error('Set PAWS_COMPUTER_SMOKE=1 to create an isolated Docker smoke computer');
    const home = await mkdtemp(join(tmpdir(), 'paws-personal-computer-smoke-'));
    console.log(JSON.stringify({ smokeHome: home }));
    let frames = 0;
    const computer = new PersonalComputer({ home, onFrame() { frames++; } });
    const signal = new AbortController().signal;
    const report: Record<string, unknown> = { home, startedAt: new Date().toISOString() };
    try {
        await computer.request({ action: 'start' }, signal);
        report.started = computer.state();
        const initialView = await computer.request({ action: 'view', viewerId: 'initial-viewer' }, signal);
        assert(initialView.frame?.data);
        const initialOwned = await computer.request({ action: 'takeover', viewerId: 'initial-viewer' }, signal);
        const repeatedView = await computer.request({ action: 'view', viewerId: 'initial-viewer' }, signal);
        assert(repeatedView.frame?.data); assert.equal(repeatedView.frame.epoch, initialOwned.state.epoch);
        await computer.request({ action: 'input', viewerId: 'initial-viewer', epoch: initialOwned.state.epoch, input: { kind: 'key', key: 'Tab' } }, signal);
        await computer.request({ action: 'release', viewerId: 'initial-viewer', epoch: initialOwned.state.epoch }, signal);
        await computer.request({ action: 'unview', viewerId: 'initial-viewer' }, signal);
        report.initialTakeoverRepeatedView = true;
        await computer.writeFile('notes/smoke.md', 'persistent isolated workspace', signal);
        assert.equal(await computer.readFile('notes/smoke.md', signal), 'persistent isolated workspace');
        const command = await computer.runCommand('id -u; test ! -S /var/run/docker.sock; test ! -d /profile; printf isolated', signal) as any;
        assert.equal(command.exitCode, 0); assert.match(command.stdout, /1000/); assert.match(command.stdout, /isolated/);
        report.workspace = true;
        const navigation = await computer.execute({ kind: 'navigate', url: 'https://www.selenium.dev/selenium/web/web-form.html' }, signal);
        report.navigation = navigation;
        const snapshot = await computer.snapshot(signal);
        assert.match(JSON.stringify(snapshot), /Web form/);
        const findRef = (result: any, name: string) => {
            const entry = Object.entries(result.snapshot.data.refs).find(([, value]: [string, any]) => value.name === name);
            assert(entry, `Missing ${name} ref`); return entry[0];
        };
        const filled = await computer.execute({ kind: 'element', action: 'fill', ref: findRef(snapshot, 'Text input'), value: 'paws-smoke-dummy' }, signal);
        assert.match(JSON.stringify(filled), /paws-smoke-dummy/);
        const pressed = await computer.execute({ kind: 'element', action: 'press', ref: findRef(filled, 'Text input'), value: 'Tab' }, signal);
        const clicked = await computer.execute({ kind: 'element', action: 'click', ref: findRef(pressed, 'Submit') }, signal);
        assert.match(JSON.stringify(clicked), /Received!|Form submitted/);
        report.chromeUseSemantic = { fill: true, press: true, click: true, observedSubmission: true };
        report.chromeUseSnapshot = true;
        const view = await computer.request({ action: 'view', viewerId: 'smoke-owner' }, signal);
        assert(view.frame?.data && view.frame.width === 1280 && view.frame.height === 800);
        await writeFile(join(home, 'view.jpg'), Buffer.from(view.frame.data, 'base64'));
        const owned = await computer.request({ action: 'takeover', viewerId: 'smoke-owner' }, signal);
        assert.equal(owned.state.control, 'human');
        await assert.rejects(computer.execute({ kind: 'key', key: 'Enter' }, signal));
        await assert.rejects(computer.runCommand('printf forbidden', signal));
        await computer.request({ action: 'input', viewerId: 'smoke-owner', epoch: owned.state.epoch, input: { kind: 'key', key: 'Tab' } }, signal);
        await computer.request({ action: 'unview', viewerId: 'smoke-owner' }, signal);
        const reclaimed = await computer.request({ action: 'takeover', viewerId: 'smoke-refreshed' }, signal);
        await assert.rejects(computer.request({ action: 'release', viewerId: 'smoke-owner', epoch: owned.state.epoch }, signal));
        await computer.request({ action: 'release', viewerId: 'smoke-refreshed', epoch: reclaimed.state.epoch }, signal);
        report.controlReclaim = true;
        // Trusted harness diagnostic: the agent's job API never mounts profile.
        const browserName = (computer as any).name as string;
        await (computer as any).docker(['exec', browserName, 'sh', '-c', 'printf profile-volume-persistent > /profile/paws-smoke-profile-marker']);
        await computer.request({ action: 'stop', epoch: computer.state().epoch }, signal);
        for (const [kind, name] of [['container', browserName], ['container', `${browserName}-egress`], ['network', `${browserName}-browser`], ['network', `${browserName}-jobs`]]) {
            assert.equal(await (computer as any).inspect(kind, name), null);
        }
        report.stopReleasedContainersAndNetworks = true;
        await computer.request({ action: 'start' }, signal);
        assert.equal(await computer.readFile('notes/smoke.md', signal), 'persistent isolated workspace');
        assert.equal(await (computer as any).docker(['exec', browserName, 'cat', '/profile/paws-smoke-profile-marker']), 'profile-volume-persistent');
        report.profileVolumePersistence = true;
        report.persistence = true;
        const privateProbe = await computer.runCommand('curl --fail --max-time 8 http://169.254.169.254/ 2>&1; printf "\nprobe=%s\n" "$?"', signal) as any;
        assert.match(privateProbe.stdout, /403|Destination unavailable|probe=22/);
        report.metadataBlocked = true;
        const isolation = await computer.runCommand(`test ! -e /profile; ! curl --noproxy '*' --connect-timeout 2 --max-time 3 http://${browserName}:9222/json/version; printf jobs-isolated`, signal) as any;
        assert.match(isolation.stdout, /jobs-isolated/); report.jobsCannotReachBrowser = true;
        const cancelPath = '/workspace/should-not-exist-after-takeover';
        const running = computer.runCommand(`(sleep 2; touch ${cancelPath}) </dev/null >/dev/null 2>&1 & wait`, signal);
        const cancelled = assert.rejects(running);
        // One bounded delay lets the explicit command start; this never queries status.
        await new Promise(resolve => setTimeout(resolve, 300));
        const cancelling = await computer.request({ action: 'takeover', viewerId: 'cancel-owner' }, signal);
        await cancelled;
        await new Promise(resolve => setTimeout(resolve, 2300));
        await computer.request({ action: 'release', viewerId: 'cancel-owner', epoch: cancelling.state.epoch }, signal);
        const killed = await computer.runCommand(`test ! -e ${cancelPath}`, signal) as any;
        assert.equal(killed.exitCode, 0); report.taskDescendantsKilled = true;
        report.frames = frames;
        report.completedAt = new Date().toISOString();
        console.log(JSON.stringify({ pass: true, ...report }, null, 2));
    } finally {
        await computer.request({ action: 'stop', epoch: computer.state().epoch }).catch(() => {});
        await computer.dispose();
        await writeFile(join(home, 'verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
