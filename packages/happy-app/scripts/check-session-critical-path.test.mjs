import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createServer } from 'node:http';
import { performance as nativePerformance, PerformanceObserver as NativePerformanceObserver } from 'node:perf_hooks';

const scriptPath = new URL('./check-session-critical-path.mjs', import.meta.url);
const origin = 'https://example.test';
const sessionId = 'known-session-123';

// Literal observations; nearest-rank p50 is item 5 and p95 is item 10.
const phase2Samples = [
  { kind: 'deep-link', cache: 'cold', retryCount: 0, deepLinkInteractiveMs: 1500 },
  { kind: 'deep-link', cache: 'cold', retryCount: 0, deepLinkInteractiveMs: 1700 },
  { kind: 'deep-link', cache: 'cold', retryCount: 0, deepLinkInteractiveMs: 1800 },
  { kind: 'deep-link', cache: 'cold', retryCount: 0, deepLinkInteractiveMs: 1900 },
  { kind: 'deep-link', cache: 'cold', retryCount: 0, deepLinkInteractiveMs: 3800 },
  { kind: 'deep-link', cache: 'warm', retryCount: 0, deepLinkInteractiveMs: 1500 },
  { kind: 'deep-link', cache: 'warm', retryCount: 0, deepLinkInteractiveMs: 1700 },
  { kind: 'deep-link', cache: 'warm', retryCount: 0, deepLinkInteractiveMs: 1850 },
  { kind: 'deep-link', cache: 'warm', retryCount: 0, deepLinkInteractiveMs: 1900 },
  { kind: 'deep-link', cache: 'warm', retryCount: 0, deepLinkInteractiveMs: 3900 },
  { kind: 'spawn', cache: 'cold', retryCount: 0, spawnRoutePaintMs: 5000, processorReadyMs: 8000 },
  { kind: 'spawn', cache: 'cold', retryCount: 0, spawnRoutePaintMs: 6000, processorReadyMs: 8500 },
  { kind: 'spawn', cache: 'cold', retryCount: 0, spawnRoutePaintMs: 6500, processorReadyMs: 9000 },
  { kind: 'spawn', cache: 'cold', retryCount: 0, spawnRoutePaintMs: 8000, processorReadyMs: 12000 },
  { kind: 'spawn', cache: 'cold', retryCount: 0, spawnRoutePaintMs: 9400, processorReadyMs: 13900 },
  { kind: 'spawn', cache: 'warm', retryCount: 0, spawnRoutePaintMs: 5000, processorReadyMs: 8000 },
  { kind: 'spawn', cache: 'warm', retryCount: 0, spawnRoutePaintMs: 6000, processorReadyMs: 8500 },
  { kind: 'spawn', cache: 'warm', retryCount: 0, spawnRoutePaintMs: 6600, processorReadyMs: 9100 },
  { kind: 'spawn', cache: 'warm', retryCount: 0, spawnRoutePaintMs: 8000, processorReadyMs: 12000 },
  { kind: 'spawn', cache: 'warm', retryCount: 0, spawnRoutePaintMs: 9500, processorReadyMs: 14000 },
];
const phase2Evidence = () => ({ resources: [], samples: structuredClone(phase2Samples) });

test('Phase 2 explicitly reports literal nearest-rank metrics without changing Phase 1', async () => {
  const evaluate = (await evaluator()).evaluatePhase2CriticalPath;
  assert.equal(typeof evaluate, 'function');
  assert.deepEqual(evaluate(phase2Evidence()), {
    ok: true, sampleCount: 20,
    deepLink: { min: 1500, p50: 1800, p95: 3900, max: 3900 },
    spawnRoutePaint: { min: 5000, p50: 6500, p95: 9500, max: 9500 },
    processorReady: { min: 8000, p50: 9000, p95: 14000, max: 14000 },
    legacySessionCalls: 0,
  });
  await withMeasurement(JSON.stringify(phase2Evidence()), input => {
    assertFailure(runCli(evaluateArgs(input)), 'INVALID_EVIDENCE');
    const result = runCli(evaluateArgs(input).map(x => x === 'evaluate-json' ? 'evaluate-phase-2-json' : x));
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).sampleCount, 20);
  });
});

for (const [field, p50, p95] of [
  ['deepLinkInteractiveMs', 2000, 4000], ['spawnRoutePaintMs', 7000, 10000], ['processorReadyMs', 10000, 15000],
]) {
  for (const percentile of ['p50', 'p95']) {
    test(`Phase 2 ${field} ${percentile} allows boundary but fails +1 ms`, async () => {
      const evaluate = (await evaluator()).evaluatePhase2CriticalPath;
      const evidence = phase2Evidence();
      const relevant = evidence.samples.filter(sample => field in sample);
      for (const cache of ['cold', 'warm']) {
        const group = relevant.filter(sample => sample.cache === cache);
        if (percentile === 'p50') for (const sample of group) sample[field] = p50;
        else group[4][field] = p95;
      }
      assert.equal(evaluate(evidence).ok, true);
      if (percentile === 'p50') for (const sample of relevant) sample[field] = p50 + 1;
      else relevant[9][field] = p95 + 1;
      assert.equal(evaluate(evidence).ok, false);
    });
  }
}

test('Phase 2 fails latency for a slow cold cohort even if pooled median passes', async () => {
  const evidence = phase2Evidence();
  for (const sample of evidence.samples.slice(0, 5)) sample.deepLinkInteractiveMs = 2001;
  assert.equal((await evaluator()).evaluatePhase2CriticalPath(evidence).ok, false);
});

for (const kind of ['deep-link', 'spawn']) for (const cache of ['cold', 'warm']) {
  test(`Phase 2 rejects fewer than five ${cache} ${kind} samples`, async () => {
    const evidence = phase2Evidence();
    evidence.samples.splice(evidence.samples.findIndex(s => s.kind === kind && s.cache === cache), 1);
    assert.throws(() => (globalPhase2)(evidence), { code: 'INSUFFICIENT_SAMPLES' });
  });
}
let globalPhase2;
test.before(async () => { globalPhase2 = (await evaluator()).evaluatePhase2CriticalPath; });

for (const [label, mutate, code] of [
  ['retry', e => { e.samples[0].retryCount = 1; }, 'RETRY_DETECTED'],
  ['missing retry', e => { delete e.samples[0].retryCount; }, 'INVALID_EVIDENCE'],
  ['fractional retry', e => { e.samples[0].retryCount = 0.5; }, 'INVALID_EVIDENCE'],
  ['unknown field', e => { e.samples[0].secret = 'private-sentinel'; }, 'INVALID_EVIDENCE'],
  ['unknown root', e => { e.token = 'private-sentinel'; }, 'INVALID_EVIDENCE'],
  ['missing duration', e => { delete e.samples[0].deepLinkInteractiveMs; }, 'INVALID_EVIDENCE'],
  ['mixed duration', e => { e.samples[0].spawnRoutePaintMs = 1; }, 'INVALID_EVIDENCE'],
  ['missing ready', e => { delete e.samples[10].processorReadyMs; }, 'INVALID_EVIDENCE'],
  ['unknown kind', e => { e.samples[0].kind = 'unknown'; }, 'INVALID_EVIDENCE'],
  ['unknown cache', e => { e.samples[0].cache = 'hot'; }, 'INVALID_EVIDENCE'],
  ['negative', e => { e.samples[0].deepLinkInteractiveMs = -1; }, 'INVALID_EVIDENCE'],
  ['nonfinite', e => { e.samples[0].deepLinkInteractiveMs = Infinity; }, 'INVALID_EVIDENCE'],
  ['string', e => { e.samples[0].deepLinkInteractiveMs = '123'; }, 'INVALID_EVIDENCE'],
  ['raw resource', e => { e.resources = [{ name: 'https://private-sentinel/session/id' }]; }, 'INVALID_EVIDENCE'],
  ['resource extra field', e => { e.resources = [{ name: 'https://redacted.invalid/resource', token: 'private-sentinel' }]; }, 'INVALID_EVIDENCE'],
]) {
  test(`Phase 2 rejects ${label} with a fixed error`, async () => {
    const evidence = phase2Evidence(); mutate(evidence);
    assert.throws(() => globalPhase2(evidence), { code });
    await withMeasurement(JSON.stringify(evidence), input => {
      assertFailure(runCli(evaluateArgs(input).map(x => x === 'evaluate-json' ? 'evaluate-phase-2-json' : x)), code);
    });
  });
}

test('Phase 2 exact legacy resource fails with a fixed code', () => {
  const evidence = phase2Evidence();
  evidence.resources = [{ name: 'https://redacted.invalid/v1/sessions' }];
  assert.throws(() => globalPhase2(evidence), { code: 'LEGACY_SESSION_REQUEST' });
});

function phase2Probe() {
  const result = runCli(['--origin', origin, '--session-id', sessionId, '--mode', 'print-phase-2-ego-probe']);
  assert.equal(result.status, 0);
  let time = 0;
  const observer = createObserverHarness();
  const context = { ...browserRequests(), PerformanceObserver: observer.PerformanceObserver,
    performance: { now: () => time, getEntriesByType: type => type === 'navigation' ? [{ startTime: 0 }] : [] } };
  return { probe: vm.runInNewContext(result.stdout, context), context, observer, at: value => { time = value; } };
}

test('Phase 2 cannot silently reuse an existing Phase 1 document probe', () => {
  const result = runCli(['--origin', origin, '--session-id', sessionId, '--mode', 'print-phase-2-ego-probe']);
  assert.equal(result.status, 0);
  assert.throws(() => vm.runInNewContext(result.stdout, { __happySessionCriticalPathProbe: {} }), { code: 'INVALID_PROBE_MODE' });
});

test('Phase 2 rejects inherited classification, arrays and throwing classification accessors', () => {
  const inherited = Object.assign(Object.create({ kind: 'spawn', cache: 'cold' }), { private: 1, extra: 2 });
  const array = Object.assign([], { kind: 'spawn', cache: 'cold' });
  const accessor = { get kind() { throw new Error('private-sentinel'); }, cache: 'cold' };
  for (const value of [inherited, array, accessor]) {
    const h = phase2Probe();
    assert.throws(() => h.probe.configureSample(value), { code: 'INVALID_SAMPLE' });
    assert.throws(() => h.probe.collect(), { code: 'INVALID_SAMPLE' });
  }
});

function deepStages(harness) {
  const { probe, at } = harness;
  probe.configureSample({ kind: 'deep-link', cache: 'cold' });
  at(100); probe.initFreshDeepLink();
  at(110); probe.markAppStage('web.fonts.critical_ready');
  at(120); probe.markAppStage('web.crypto.ready');
  at(130); probe.markAppStage('web.credentials.ready');
  at(140); probe.markFreshHeaderVisible();
  at(150); probe.markAppStage('web.session.snapshot_started');
  at(160); probe.markAppStage('web.session.snapshot_completed');
  at(170); probe.markAppStage('web.messages.latest_started');
  at(180); probe.markAppStage('web.messages.latest_completed');
  at(190); probe.markAppStage('web.session.store_committed');
}

test('Phase 2 consumes app stages and freezes independent redacted samples', async () => {
  const h = phase2Probe(); deepStages(h);
  h.observer.emit([{ name: 'https://secret.example/private-sentinel?token=private', startTime: 155 }]);
  h.at(200); h.probe.markFreshLatestMessageComplete();
  const first = h.probe.collect();
  assert.equal(Object.isFrozen(first.samples[0]), true);
  h.probe.configureSample({ kind: 'spawn', cache: 'warm' });
  h.at(1000); h.probe.startNewTextSession();
  h.at(1100); h.probe.markNewSessionEvent();
  h.at(1200); h.probe.markLocalQueue();
  h.at(1300); h.probe.markAppStage('web.session.navigated');
  h.at(1500); h.probe.markRouteNavigation();
  h.at(1800); h.probe.markProcessorReady();
  h.at(1900); h.probe.markFirstAgentEvent();
  h.at(2100); h.probe.markTurnCompletion();
  await h.context.fetch('/v1/sessions'); // After frozen intervals must be excluded.
  assert.deepEqual(JSON.parse(JSON.stringify(h.probe.collect())), {
    resources: [{ name: 'https://redacted.invalid/resource' }],
    samples: [
      { kind: 'deep-link', cache: 'cold', retryCount: 0, deepLinkInteractiveMs: 200 },
      { kind: 'spawn', cache: 'warm', retryCount: 0, spawnRoutePaintMs: 500, processorReadyMs: 800 },
    ],
  });
  assert.equal(first.samples.length, 1);
});

for (const [label, action, code] of [
  ['missing stage', h => h.probe.collect(), 'MISSING_APP_STAGE'],
  ['duplicate stage', h => h.probe.markAppStage('web.crypto.ready'), 'DUPLICATE_APP_STAGE'],
  ['unknown stage', h => h.probe.markAppStage('private-sentinel'), 'INVALID_APP_STAGE'],
  ['out of order', h => { h.at(10); h.probe.markFreshLatestMessageComplete(); }, 'OUT_OF_ORDER_APP_STAGE'],
  ['hidden retry', h => h.probe.initFreshDeepLink(), 'RETRY_DETECTED'],
  ['reported retry', h => h.probe.markRetry(), 'RETRY_DETECTED'],
]) {
  test(`Phase 2 latches ${label} even when the app bridge catches the error`, () => {
    const h = phase2Probe(); deepStages(h);
    assert.throws(() => action(h), { code });
    assert.throws(() => h.probe.collect(), { code });
  });
}

test('Phase 2 rejects completed operations before their start', () => {
  const h = phase2Probe();
  h.probe.configureSample({ kind: 'deep-link', cache: 'cold' }); h.probe.initFreshDeepLink();
  assert.throws(() => h.probe.markAppStage('web.messages.latest_completed'), { code: 'OUT_OF_ORDER_APP_STAGE' });
});

test('Phase 2 rejects duplicate producer route/store events rather than hiding them', () => {
  for (const stage of ['web.route.mounted', 'web.session.store_committed']) {
    const h = phase2Probe(); deepStages(h);
    assert.throws(() => h.probe.markAppStage(stage), { code: 'DUPLICATE_APP_STAGE' });
    assert.throws(() => h.probe.collect(), { code: 'DUPLICATE_APP_STAGE' });
  }
});

test('Phase 2 pending exact-path legacy calls are redacted; subpaths are allowed', async () => {
  const h = phase2Probe(); deepStages(h);
  await h.context.fetch('/v1/sessions/one?private-sentinel');
  await h.context.fetch('/v1/sessions?private-sentinel');
  h.at(200); h.probe.markFreshLatestMessageComplete();
  assert.deepEqual(JSON.parse(JSON.stringify(h.probe.collect().resources)), [{ name: 'https://redacted.invalid/v1/sessions' }]);
});

test('Phase 2 rejects instrumentation replacement', () => {
  const h = phase2Probe(); deepStages(h);
  h.context.fetch = () => undefined;
  assert.throws(() => h.probe.collect(), { code: 'RESOURCE_COLLECTION_FAILED' });
});

test('Phase 2 deep-link paint does not require unrelated spawn navigation', () => {
  const h = phase2Probe(); deepStages(h);
  h.probe.markRouteNavigation();
  h.at(200); h.probe.markFreshLatestMessageComplete();
  assert.equal(h.probe.collect().samples[0].deepLinkInteractiveMs, 200);
});

test('Phase 2 can boot on the compose page before explicitly arming a spawn sample', () => {
  const h = phase2Probe();
  h.probe.initFreshDeepLink();
  h.probe.markAppStage('web.fonts.critical_ready');
  h.probe.configureSample({ kind: 'spawn', cache: 'cold' });
  h.probe.startNewTextSession();
  h.probe.markAppStage('web.session.snapshot_started');
  h.probe.markAppStage('web.session.snapshot_completed');
  h.probe.markNewSessionEvent(); h.probe.markLocalQueue();
  h.probe.markAppStage('web.session.navigated'); h.probe.markRouteNavigation();
  h.probe.markProcessorReady(); h.probe.markFirstAgentEvent(); h.probe.markTurnCompletion();
  assert.equal(h.probe.collect().samples[0].kind, 'spawn');
});

function browserRequests() {
  return {
    document: { readyState: 'loading', scripts: [], baseURI: origin },
    URL, Request,
    fetch: async () => ({ ok: true }),
    XMLHttpRequest: class { open() {} send() {} },
  };
}

test('covers a real in-flight fetch begun during deep link whose ResourceTiming arrives after freeze', async () => {
  const result = runCli(['--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe']);
  let release;
  let accepted;
  const started = new Promise(resolve => { accepted = resolve; });
  const server = createServer((_request, response) => {
    release = () => { response.end('synthetic-response'); };
    accepted();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const target = 'http://127.0.0.1:' + server.address().port + '/v1/sessions';
  const context = { ...browserRequests(), fetch: globalThis.fetch, PerformanceObserver: NativePerformanceObserver,
    performance: nativePerformance };
  const probe = vm.runInNewContext(result.stdout, context);
  try {
    probe.initFreshDeepLink();
    const pending = context.fetch(target);
    await started;
    assert.equal(nativePerformance.getEntriesByType('resource').some(entry => entry.name === target), false);
    probe.markFreshHeaderVisible();
    probe.markFreshLatestMessageComplete();
    probe.startNewTextSession();
    probe.markRouteNavigation();
    release();
    await (await pending).text();
    await new Promise(resolve => setImmediate(resolve));
    probe.markTurnCompletion();
    assert.equal((await evaluator()).evaluateCriticalPath(probe.collect()).legacySessionCalls, 1);
  } finally {
    release?.();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('fails closed when installed after application scripts could already have started requests', () => {
  const result = runCli(['--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe']);
  const context = { ...browserRequests(), document: { readyState: 'complete', scripts: [{}] },
    PerformanceObserver: createObserverHarness().PerformanceObserver,
    performance: { now: () => 100, getEntriesByType: () => [] } };
  const probe = vm.runInNewContext(result.stdout, context);
  assertCollectionFailure(() => probe.initFreshDeepLink());
});

function passingRun(overrides = {}) {
  return {
    resources: [{ name: 'https://example.test/v1/session/known-session-123' }],
    deepLinkInteractiveMs: 2_000,
    spawnNavigateMs: 7_000,
    ...overrides,
  };
}

test('counts pending XHR at send, excludes later requests and never issues its own request', async () => {
  const { probe, context, init, complete } = createFaultProbe();
  init.deepLink();
  const request = new context.XMLHttpRequest();
  request.open('GET', '/v1/sessions?redacted');
  request.send();
  complete.deepLink();
  init.spawn();
  complete.spawn();
  assert.equal((await evaluator()).evaluateCriticalPath(probe.collect()).legacySessionCalls, 1);
  await context.fetch('/v1/sessions');
  assert.equal((await evaluator()).evaluateCriticalPath(probe.collect()).legacySessionCalls, 1);
});

for (const api of ['fetch', 'open', 'send']) {
  test('permanently fails closed if request instrumentation is replaced: ' + api, () => {
    const { probe, context, init, complete } = createFaultProbe();
    init.deepLink(); complete.deepLink(); init.spawn(); complete.spawn();
    const owner = api === 'fetch' ? context : context.XMLHttpRequest.prototype;
    const original = owner[api];
    owner[api] = () => undefined;
    assertCollectionFailure(() => probe.collect());
    owner[api] = original;
    assertCollectionFailure(() => probe.collect());
  });
}

test('redacts an accessor failure while checking request instrumentation', () => {
  const { probe, context, init, complete } = createFaultProbe();
  init.deepLink(); complete.deepLink(); init.spawn(); complete.spawn();
  Object.defineProperty(context, 'fetch', { configurable: true, get: throwCollectionFault });
  assertCollectionFailure(() => probe.collect());
});

test('keeps native fetch rejection semantics and still counts its initiation', async () => {
  const result = runCli(['--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe']);
  const rejected = new Error('synthetic-network-failure');
  let calls = 0;
  const context = { ...browserRequests(), fetch: () => { calls++; return Promise.reject(rejected); },
    PerformanceObserver: createObserverHarness().PerformanceObserver,
    performance: { now: () => 10, getEntriesByType: () => [] } };
  const probe = vm.runInNewContext(result.stdout, context);
  assert.equal(calls, 0);
  probe.initFreshDeepLink();
  await assert.rejects(context.fetch('/v1/sessions'), error => error === rejected);
  probe.markFreshHeaderVisible(); probe.markFreshLatestMessageComplete();
  // Move the second interval beyond the first initiation.
  context.performance.now = () => 20;
  probe.startNewTextSession(); probe.markRouteNavigation(); probe.markTurnCompletion();
  assert.equal((await evaluator()).evaluateCriticalPath(probe.collect()).legacySessionCalls, 1);
  assert.equal(calls, 1);
});

async function evaluator() {
  return import('./check-session-critical-path.mjs');
}

async function withMeasurement(contents, callback) {
  const directory = await mkdtemp(join(tmpdir(), 'session-critical-path-'));
  const inputPath = join(directory, 'measurement.json');
  await writeFile(inputPath, contents, 'utf8');
  try {
    return await callback(inputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function withMissingMeasurement(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'session-critical-path-'));
  try {
    return await callback(join(directory, 'not-present.json'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath.pathname, ...args], { encoding: 'utf8' });
}

function failure(code) {
  return `${JSON.stringify({ ok: false, error: { code } })}\n`;
}

function evaluateArgs(inputPath) {
  return [
    '--origin', origin,
    '--session-id', sessionId,
    '--mode', 'evaluate-json',
    '--input', inputPath,
  ];
}

function assertFailure(result, code) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, failure(code));
}

function createObserverHarness() {
  const observers = [];
  class PerformanceObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      this.pending = [];
      observers.push(this);
    }

    observe() {}

    disconnect() {
      this.disconnected = true;
      this.pending = [];
    }

    takeRecords() {
      const records = this.pending;
      this.pending = [];
      return records;
    }
  }
  return {
    PerformanceObserver,
    observers,
    queue(entries) {
      for (const observer of observers) {
        if (!observer.disconnected) observer.pending.push(...entries);
      }
    },
    emit(entries) {
      for (const observer of observers) {
        if (!observer.disconnected) {
          observer.callback({ getEntries: () => entries });
        }
      }
    },
    deliverTo(observer, entries) {
      observer.callback({ getEntries: () => entries });
    },
  };
}

function createFaultProbe() {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  assert.equal(result.status, 0);
  const observer = createObserverHarness();
  let now = 0;
  const context = {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => (type === 'navigation' ? [{ startTime: 0 }] : []),
    },
  };
  const probe = vm.runInNewContext(result.stdout, context);
  return {
    probe, context, observer,
    init: {
      deepLink: () => probe.initFreshDeepLink(),
      spawn: () => probe.startNewTextSession(),
    },
    complete: {
      deepLink() {
        now += 10;
        probe.markFreshHeaderVisible();
        now += 10;
        probe.markFreshLatestMessageComplete();
      },
      spawn() {
        now += 10;
        probe.markNewSessionEvent();
        probe.markLocalQueue();
        probe.markRouteNavigation();
        probe.markFirstAgentEvent();
        now += 10;
        probe.markTurnCompletion();
      },
    },
  };
}

function captureError(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
}

function assertCollectionFailure(action) {
  assert.throws(action, (error) => {
    assert.equal(error.code, 'RESOURCE_COLLECTION_FAILED');
    assert.equal(error.message, 'Critical-path resource collection failed.');
    assert.doesNotMatch(`${error}\n${error.stack}\n${JSON.stringify(error)}`, /private-fault-sentinel/);
    return true;
  });
}

function throwCollectionFault() {
  throw new Error('private-fault-sentinel');
}

for (const path of ['deepLink', 'spawn']) {
  for (const source of ['callback getEntries', 'callback iterator', 'entry name', 'entry startTime', 'takeRecords', 'disconnect']) {
    test(`${path} latches ${source} failures even after all marks complete and the source recovers`, () => {
      const { probe, observer, init, complete } = createFaultProbe();
      init.deepLink();
      init.spawn();
      const target = observer.observers[path === 'deepLink' ? 0 : 1];
      const originalTakeRecords = target.takeRecords;
      const originalDisconnect = target.disconnect;
      let callbackError;
      if (source === 'takeRecords') {
        target.takeRecords = throwCollectionFault;
      } else if (source === 'disconnect') {
        target.disconnect = () => {
          originalDisconnect.call(target);
          throwCollectionFault();
        };
      } else {
        let list = { getEntries: throwCollectionFault };
        if (source === 'callback iterator') {
          list = { getEntries: () => ({ [Symbol.iterator]: throwCollectionFault }) };
        } else if (source.startsWith('entry ')) {
          const entry = { name: 'https://example.test/v1/sessions', startTime: 1 };
          Object.defineProperty(entry, source.slice(6), { get: throwCollectionFault });
          list = { getEntries: () => [entry] };
        }
        callbackError = captureError(() => target.callback(list));
      }

      const completionErrors = {
        deepLink: captureError(complete.deepLink),
        spawn: captureError(complete.spawn),
      };
      assertCollectionFailure(() => probe.collect());
      assert.equal(callbackError, undefined, 'observer callbacks must not throw asynchronously');
      assertCollectionFailure(() => { throw completionErrors[path]; });
      assert.equal(completionErrors[path === 'deepLink' ? 'spawn' : 'deepLink'], undefined);
      assert.equal(target.disconnected, true);

      target.takeRecords = originalTakeRecords;
      target.disconnect = originalDisconnect;
      assert.doesNotThrow(() => observer.deliverTo(target, []));
      assertCollectionFailure(complete[path]);
      assertCollectionFailure(() => probe.collect());
    });
  }

  for (const source of ['missing observer', 'constructor', 'observe', 'seed read', 'seed entry', 'start read']) {
    test(`${path} invalidates passing evidence before reinitialization fails at ${source}`, async () => {
      const { evaluateCriticalPath } = await evaluator();
      const { probe, context, observer, init, complete } = createFaultProbe();
      init.deepLink();
      complete.deepLink();
      init.spawn();
      complete.spawn();
      assert.equal(evaluateCriticalPath(probe.collect()).ok, true);

      const originalRead = context.performance.getEntriesByType;
      const originalNow = context.performance.now;
      const originalObserve = observer.PerformanceObserver.prototype.observe;
      if (source === 'missing observer') context.PerformanceObserver = undefined;
      if (source === 'constructor') context.PerformanceObserver = function () { throwCollectionFault(); };
      if (source === 'observe') observer.PerformanceObserver.prototype.observe = throwCollectionFault;
      if (source === 'seed read') {
        context.performance.getEntriesByType = (type) => type === 'resource' ? throwCollectionFault() : originalRead(type);
      }
      if (source === 'seed entry') {
        const entry = { startTime: 100, get name() { return throwCollectionFault(); } };
        context.performance.getEntriesByType = (type) => type === 'resource' ? [entry] : originalRead(type);
      }
      if (source === 'start read') {
        if (path === 'deepLink') context.performance.getEntriesByType = throwCollectionFault;
        else context.performance.now = throwCollectionFault;
      }

      const initError = captureError(init[path]);
      assertCollectionFailure(() => probe.collect());
      assertCollectionFailure(() => { throw initError; });
      assert.ok(observer.observers.every((instance) => instance.disconnected), 'partially created observers must be disconnected');

      context.PerformanceObserver = observer.PerformanceObserver;
      context.performance.getEntriesByType = originalRead;
      context.performance.now = originalNow;
      observer.PerformanceObserver.prototype.observe = originalObserve;
      assertCollectionFailure(complete[path]);
      assertCollectionFailure(() => probe.collect());
      init[path]();
      complete[path]();
      assert.equal(evaluateCriticalPath(probe.collect()).ok, true, 'only a new healthy generation may recover');
    });
  }
}

for (const mode of ['print-ego-probe', 'evaluate-json']) {
  test(`README ${mode} command runs through pnpm with substituted placeholders`, async () => {
    const readme = await readFile(new URL('../../../docs/acceptance/session-critical-path/README.md', import.meta.url), 'utf8');
    const commands = [...readme.matchAll(/```sh\n([\s\S]*?)```/g)]
      .map((match) => match[1]).filter((command) => command.includes(`--mode ${mode}`));
    assert.equal(commands.length, 1);
    await withMeasurement(JSON.stringify(passingRun()), async (inputPath) => {
      const values = { '<https-origin>': origin, '<known-session-id>': sessionId, '<measurement-json-path>': inputPath };
      const command = commands[0].replace(/<[^>]+>/g, (placeholder) => {
        assert.ok(Object.hasOwn(values, placeholder));
        return `'${values[placeholder].replaceAll("'", "'\\''")}'`;
      });
      const result = spawnSync('/bin/sh', ['-c', command], {
        cwd: new URL('../../../', import.meta.url), encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      if (mode === 'evaluate-json') {
        assert.equal(JSON.parse(result.stdout).ok, true);
      } else {
        assert.equal(typeof vm.runInNewContext(result.stdout).collect, 'function');
      }
    });
  });
}

test('passes a resource-free full-list path and threshold boundary measurements', async () => {
  const { evaluateCriticalPath } = await evaluator();

  assert.deepEqual(evaluateCriticalPath(passingRun()), {
    ok: true,
    legacySessionCalls: 0,
    deepLinkInteractiveMs: 2_000,
    spawnNavigateMs: 7_000,
  });
});

test('fails only an exact /v1/sessions pathname, including query and fragment URLs', async () => {
  const { evaluateCriticalPath } = await evaluator();
  const result = evaluateCriticalPath(passingRun({
    resources: [
      { name: 'https://example.test/v1/sessions?limit=50#latest' },
      { name: 'https://example.test/v1/sessions/archive' },
      { name: 'https://example.test/api/v1/sessions' },
    ],
  }));

  assert.equal(result.ok, false);
  assert.equal(result.legacySessionCalls, 1);
});

test('fails a deep link that takes more than 2000ms', async () => {
  const { evaluateCriticalPath } = await evaluator();
  assert.equal(evaluateCriticalPath(passingRun({ deepLinkInteractiveMs: 2_001 })).ok, false);
});

test('fails a new-session navigation that takes more than 7000ms', async () => {
  const { evaluateCriticalPath } = await evaluator();
  assert.equal(evaluateCriticalPath(passingRun({ spawnNavigateMs: 7_001 })).ok, false);
});

test('evaluate-json prints only parseable success JSON and evaluator failures remain parseable', async () => {
  await withMeasurement(JSON.stringify(passingRun()), async (inputPath) => {
    const result = runCli(evaluateArgs(inputPath));
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      legacySessionCalls: 0,
      deepLinkInteractiveMs: 2_000,
      spawnNavigateMs: 7_000,
    });
  });

  await withMeasurement(JSON.stringify(passingRun({
    resources: [{ name: 'https://example.test/v1/sessions' }],
  })), async (inputPath) => {
    const result = runCli(evaluateArgs(inputPath));
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      legacySessionCalls: 1,
      deepLinkInteractiveMs: 2_000,
      spawnNavigateMs: 7_000,
    });
  });
});

test('emits fixed machine-readable argument, origin, session, mode, and input failures', async () => {
  assertFailure(runCli([]), 'INVALID_ARGS');
  assertFailure(runCli([
    '--origin', 'http://example.test', '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]), 'INVALID_ORIGIN');
  assertFailure(runCli([
    '--origin', 'https://user:password@example.test', '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]), 'INVALID_ORIGIN');
  assertFailure(runCli([
    '--origin', origin, '--session-id', '   ', '--mode', 'print-ego-probe',
  ]), 'INVALID_SESSION');
  assertFailure(runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'unknown-mode',
  ]), 'INVALID_MODE');
  assertFailure(runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'evaluate-json',
  ]), 'MISSING_INPUT');
  await withMissingMeasurement(async (inputPath) => {
    const result = runCli(evaluateArgs(inputPath));
    assertFailure(result, 'UNREADABLE_INPUT');
    assert.doesNotMatch(result.stderr, new RegExp(inputPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('rejects malformed JSON and every malformed minimal-evidence shape with fixed codes', async () => {
  for (const contents of ['{', '{\n"resources":']) {
    await withMeasurement(contents, async (inputPath) => {
      assertFailure(runCli(evaluateArgs(inputPath)), 'INVALID_JSON');
    });
  }

  const invalidEvidence = [
    JSON.stringify({}),
    JSON.stringify({ resources: [], deepLinkInteractiveMs: 1 }),
    JSON.stringify({ resources: [], spawnNavigateMs: 1 }),
    JSON.stringify({ resources: 'not-an-array', deepLinkInteractiveMs: 1, spawnNavigateMs: 1 }),
    JSON.stringify(passingRun({ deepLinkInteractiveMs: -1 })),
    '{"resources":[],"deepLinkInteractiveMs":1e999,"spawnNavigateMs":1}',
    JSON.stringify({ ...passingRun(), extra: 'not-minimal' }),
    JSON.stringify(passingRun({ resources: [{ name: 'https://example.test/ok', extra: true }] })),
    JSON.stringify(passingRun({ resources: [null] })),
    JSON.stringify(passingRun({ resources: [{}] })),
    JSON.stringify(passingRun({ resources: [{ name: 42 }] })),
    JSON.stringify(passingRun({ resources: [{ name: 'not a URL' }] })),
  ];
  for (const contents of invalidEvidence) {
    await withMeasurement(contents, async (inputPath) => {
      assertFailure(runCli(evaluateArgs(inputPath)), 'INVALID_EVIDENCE');
    });
  }
});

test('print-ego-probe supplies a self-contained lifecycle that collects both paths in a browser-neutral VM', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');

  let now = 0;
  const observer = createObserverHarness();
  const context = {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => {
        if (type === 'navigation') return [{ startTime: 0 }];
        if (type === 'resource') return [{ name: 'https://example.test/api/turn', startTime: 10 }];
        return [];
      },
    },
  };
  const probe = vm.runInNewContext(result.stdout, context);

  probe.initFreshDeepLink();
  now = 120;
  probe.markFreshHeaderVisible();
  now = 550;
  probe.markFreshLatestMessageComplete();
  now = 1_000;
  probe.startNewTextSession();
  now = 1_050;
  probe.markNewSessionEvent();
  now = 1_100;
  probe.markLocalQueue();
  now = 1_750;
  probe.markRouteNavigation();
  now = 1_900;
  probe.markFirstAgentEvent();
  now = 2_100;
  probe.markTurnCompletion();

  assert.deepEqual(JSON.parse(JSON.stringify(probe.collect())), {
    resources: [{ name: 'https://example.test/api/turn' }],
    deepLinkInteractiveMs: 550,
    spawnNavigateMs: 750,
  });
  assert.equal(typeof context.__happySessionCriticalPathProbe, 'object');
});

test('the probe survives a same-document route transition without reading credentials or issuing requests', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  let now = 0;
  const observer = createObserverHarness();
  const context = {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => (type === 'navigation' ? [{ startTime: 0 }] : []),
    },
  };
  const firstReference = vm.runInNewContext(result.stdout, context);
  firstReference.initFreshDeepLink();
  now = 10;
  firstReference.markFreshHeaderVisible();
  now = 20;
  firstReference.markFreshLatestMessageComplete();
  firstReference.startNewTextSession();
  now = 30;

  const afterRouteTransition = vm.runInNewContext(result.stdout, context);
  assert.equal(afterRouteTransition, firstReference);
  afterRouteTransition.markRouteNavigation();
  afterRouteTransition.markTurnCompletion();
  assert.equal(afterRouteTransition.collect().spawnNavigateMs, 10);
  assert.doesNotMatch(result.stdout, /localStorage|sessionStorage|document\.cookie|authorization|bearer|password|postMessage\(/i);
});

test('reinitializing either path invalidates prior completion marks and resource generations', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  let now = 0;
  let resources = [{ name: 'https://example.test/unrelated-before-deep', startTime: -1 }];
  const observer = createObserverHarness();
  const context = {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => {
        if (type === 'navigation') return [{ startTime: 0 }];
        if (type === 'resource') return resources;
        return [];
      },
    },
  };
  const probe = vm.runInNewContext(result.stdout, context);

  probe.initFreshDeepLink();
  resources = [...resources, { name: 'https://example.test/old-deep', startTime: 1 }];
  now = 10;
  probe.markFreshHeaderVisible();
  now = 20;
  probe.markFreshLatestMessageComplete();
  probe.startNewTextSession();
  resources = [...resources, { name: 'https://example.test/old-spawn', startTime: 21 }];
  now = 30;
  probe.markRouteNavigation();
  probe.markTurnCompletion();

  resources = [];
  probe.initFreshDeepLink();
  const currentDeep = { name: 'https://example.test/current-deep', startTime: 41 };
  resources = [...resources, currentDeep];
  observer.emit([currentDeep]);
  now = 50;
  probe.markFreshHeaderVisible();
  assert.throws(() => probe.collect(), /lifecycle mark is missing/);
  now = 70;
  probe.markFreshLatestMessageComplete();

  probe.startNewTextSession();
  resources = [...resources, { name: 'https://example.test/stale-before-current-spawn', startTime: 71 }];
  now = 80;
  probe.markRouteNavigation();
  probe.markTurnCompletion();
  probe.startNewTextSession();
  const currentSpawn = { name: 'https://example.test/current-spawn', startTime: 81 };
  resources = [...resources, currentSpawn];
  observer.emit([currentSpawn]);
  assert.throws(() => probe.collect(), /lifecycle mark is missing/);
  now = 110;
  probe.markRouteNavigation();
  now = 120;
  probe.markTurnCompletion();

  assert.deepEqual(JSON.parse(JSON.stringify(probe.collect())), {
    resources: [
      { name: 'https://example.test/current-deep' },
      { name: 'https://example.test/current-spawn' },
    ],
    deepLinkInteractiveMs: 70,
    spawnNavigateMs: 30,
  });
});

test('freezes each path resource snapshot before later timing-buffer eviction', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  let now = 0;
  let resources = [{ name: 'https://example.test/unrelated-before-deep', startTime: -1 }];
  const observer = createObserverHarness();
  const context = {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => {
        if (type === 'navigation') return [{ startTime: 0 }];
        if (type === 'resource') return resources;
        return [];
      },
    },
  };
  const probe = vm.runInNewContext(result.stdout, context);

  probe.initFreshDeepLink();
  const deepLegacy = { name: 'https://example.test/v1/sessions?legacy=deep', startTime: 1 };
  resources = [...resources, deepLegacy];
  observer.emit([deepLegacy]);
  now = 20;
  probe.markFreshHeaderVisible();
  now = 40;
  probe.markFreshLatestMessageComplete();
  resources = [{ name: 'https://example.test/unrelated-before-spawn', startTime: 39 }];

  probe.startNewTextSession();
  const spawnRoute = { name: 'https://example.test/new-session-route', startTime: 50 };
  resources = [...resources, spawnRoute];
  observer.emit([spawnRoute]);
  now = 70;
  probe.markRouteNavigation();
  resources = [];
  now = 80;
  probe.markTurnCompletion();

  assert.deepEqual(JSON.parse(JSON.stringify(probe.collect())), {
    resources: [
      { name: 'https://example.test/v1/sessions?legacy=deep' },
      { name: 'https://example.test/new-session-route' },
    ],
    deepLinkInteractiveMs: 40,
    spawnNavigateMs: 30,
  });
});

test('captures deep-link resources from navigation start and observer-delivered spawn resources through turn completion', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  let now = 100;
  let resources = [
    { name: 'https://example.test/v1/sessions?deep-index-zero', startTime: 5 },
    { name: 'https://example.test/deep-pre-init-a', startTime: 10 },
    { name: 'https://example.test/deep-pre-init-b', startTime: 20 },
    { name: 'https://example.test/repeated-resource', startTime: 25 },
    { name: 'https://example.test/repeated-resource', startTime: 26 },
  ];
  const observer = createObserverHarness();
  const context = {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => {
        if (type === 'navigation') return [{ startTime: 0 }];
        if (type === 'resource') return resources;
        return [];
      },
    },
  };
  const probe = vm.runInNewContext(result.stdout, context);

  probe.initFreshDeepLink();
  resources = [];
  now = 120;
  probe.markFreshHeaderVisible();
  now = 140;
  probe.markFreshLatestMessageComplete();

  now = 200;
  resources = [{ name: 'https://example.test/before-send-click', startTime: 190 }];
  probe.startNewTextSession();
  now = 230;
  probe.markRouteNavigation();
  const afterNavigationLegacy = { name: 'https://example.test/v1/sessions?after-navigation', startTime: 240 };
  observer.emit([afterNavigationLegacy]);
  resources = [];
  assert.throws(() => probe.collect(), /lifecycle mark is missing/);
  now = 260;
  probe.markTurnCompletion();

  assert.deepEqual(JSON.parse(JSON.stringify(probe.collect())), {
    resources: [
      { name: 'https://example.test/v1/sessions?deep-index-zero' },
      { name: 'https://example.test/deep-pre-init-a' },
      { name: 'https://example.test/deep-pre-init-b' },
      { name: 'https://example.test/repeated-resource' },
      { name: 'https://example.test/repeated-resource' },
      { name: 'https://example.test/v1/sessions?after-navigation' },
    ],
    deepLinkInteractiveMs: 140,
    spawnNavigateMs: 30,
  });
});

test('disconnects old observers on reinit and blocks stale observer writes', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  let now = 0;
  let resources = [];
  const observer = createObserverHarness();
  const context = {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => {
        if (type === 'navigation') return [{ startTime: 0 }];
        if (type === 'resource') return resources;
        return [];
      },
    },
  };
  const probe = vm.runInNewContext(result.stdout, context);

  probe.initFreshDeepLink();
  const firstDeepObserver = observer.observers[0];
  probe.initFreshDeepLink();
  assert.equal(firstDeepObserver.disconnected, true);
  observer.deliverTo(firstDeepObserver, [{ name: 'https://example.test/stale-deep-observer', startTime: 1 }]);
  const currentDeep = { name: 'https://example.test/current-deep-observer', startTime: 2 };
  observer.emit([currentDeep]);
  now = 10;
  probe.markFreshHeaderVisible();
  now = 20;
  probe.markFreshLatestMessageComplete();

  now = 30;
  probe.startNewTextSession();
  const firstSpawnObserver = observer.observers[2];
  now = 40;
  probe.startNewTextSession();
  assert.equal(firstSpawnObserver.disconnected, true);
  observer.deliverTo(firstSpawnObserver, [{ name: 'https://example.test/stale-spawn-observer', startTime: 35 }]);
  const currentSpawn = { name: 'https://example.test/current-spawn-observer', startTime: 45 };
  observer.emit([currentSpawn]);
  now = 50;
  probe.markRouteNavigation();
  now = 60;
  probe.markTurnCompletion();

  assert.deepEqual(JSON.parse(JSON.stringify(probe.collect())).resources, [
    { name: 'https://example.test/current-deep-observer' },
    { name: 'https://example.test/current-spawn-observer' },
  ]);
});

test('fails closed when PerformanceObserver is unavailable', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  const probe = vm.runInNewContext(result.stdout, {
    ...browserRequests(),
    performance: {
      now: () => 0,
      getEntriesByType: (type) => (type === 'navigation' ? [{ startTime: 0 }] : []),
    },
  });

  assertCollectionFailure(() => probe.initFreshDeepLink());
  assertCollectionFailure(() => probe.collect());
});

test('drains undelivered resource records before freezing either path without duplicating entries', () => {
  const result = runCli([
    '--origin', origin, '--session-id', sessionId, '--mode', 'print-ego-probe',
  ]);
  let now = 100;
  const seeded = { name: 'https://example.test/seeded', startTime: 10 };
  let resources = [seeded];
  const observer = createObserverHarness();
  const probe = vm.runInNewContext(result.stdout, {
    ...browserRequests(),
    PerformanceObserver: observer.PerformanceObserver,
    performance: {
      now: () => now,
      getEntriesByType: (type) => (type === 'navigation' ? [{ startTime: 0 }] : resources),
    },
  });

  probe.initFreshDeepLink();
  const deepLegacy = { name: 'https://example.test/v1/sessions?pending-deep', startTime: 110 };
  observer.queue([seeded, deepLegacy]);
  resources = [];
  now = 120;
  probe.markFreshHeaderVisible();
  now = 140;
  probe.markFreshLatestMessageComplete();
  assert.equal(observer.observers[0].disconnected, true);

  now = 200;
  probe.startNewTextSession();
  now = 220;
  probe.markRouteNavigation();
  now = 230;
  probe.markFirstAgentEvent();
  const spawnLegacy = { name: 'https://example.test/v1/sessions?pending-spawn', startTime: 240 };
  observer.emit([spawnLegacy]);
  observer.queue([
    { name: 'https://example.test/pre-send', startTime: 199 },
    spawnLegacy,
    { ...spawnLegacy },
  ]);
  now = 260;
  probe.markTurnCompletion();
  assert.equal(observer.observers[1].disconnected, true);
  observer.deliverTo(observer.observers[0], [{ name: 'https://example.test/after-deep-freeze', startTime: 270 }]);
  observer.deliverTo(observer.observers[1], [{ name: 'https://example.test/after-spawn-freeze', startTime: 270 }]);
  for (const instance of observer.observers) {
    assert.doesNotThrow(() => instance.callback({ getEntries: throwCollectionFault }));
  }

  assert.deepEqual(JSON.parse(JSON.stringify(probe.collect())), {
    resources: [
      { name: 'https://example.test/seeded' },
      { name: 'https://example.test/v1/sessions?pending-deep' },
      { name: 'https://example.test/v1/sessions?pending-spawn' },
      { name: 'https://example.test/v1/sessions?pending-spawn' },
    ],
    deepLinkInteractiveMs: 140,
    spawnNavigateMs: 20,
  });
});
