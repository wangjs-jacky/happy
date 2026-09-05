import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MODES = new Set(['evaluate-json', 'print-ego-probe', 'evaluate-phase-2-json', 'print-phase-2-ego-probe']);
const REQUIRED_EVIDENCE_FIELDS = new Set([
  'resources',
  'deepLinkInteractiveMs',
  'spawnNavigateMs',
]);

class CliFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function evaluateCriticalPath(run) {
  const legacyCalls = run.resources.filter((resource) => (
    new URL(resource.name).pathname === '/v1/sessions'
  ));

  return {
    ok: legacyCalls.length === 0
      && run.deepLinkInteractiveMs <= 2_000
      && run.spawnNavigateMs <= 7_000,
    legacySessionCalls: legacyCalls.length,
    deepLinkInteractiveMs: run.deepLinkInteractiveMs,
    spawnNavigateMs: run.spawnNavigateMs,
  };
}

function readPlainDataObject(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) return null;
    const data = new Map();
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      data.set(key, descriptor.value);
    }
    return data;
  } catch {
    return null;
  }
}

function readPlainDataArray(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) return null;
    const items = [];
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      items.push(descriptor.value);
    }
    return items;
  } catch {
    return null;
  }
}

function exactDataFields(data, fields) {
  return data instanceof Map && data.size === fields.length && fields.every(field => data.has(field));
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0], p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}

export function evaluatePhase2CriticalPath(run) {
  const invalid = () => { throw new CliFailure('INVALID_EVIDENCE'); };
  const root = readPlainDataObject(run);
  if (!exactDataFields(root, ['resources', 'samples'])) invalid();
  const resourceValues = readPlainDataArray(root.get('resources'));
  const sampleValues = readPlainDataArray(root.get('samples'));
  if (!resourceValues || !sampleValues) invalid();
  const resources = [];
  for (const resourceValue of resourceValues) {
    const resource = readPlainDataObject(resourceValue);
    if (!exactDataFields(resource, ['name'])
      || !['https://redacted.invalid/resource', 'https://redacted.invalid/v1/sessions'].includes(resource.get('name'))) invalid();
    resources.push({ name: resource.get('name') });
  }
  const samples = [];
  for (const sampleValue of sampleValues) {
    const data = readPlainDataObject(sampleValue);
    if (!data) invalid();
    const kind = data.get('kind');
    const metrics = kind === 'deep-link' ? ['deepLinkInteractiveMs'] : ['spawnRoutePaintMs', 'processorReadyMs'];
    if (!exactDataFields(data, ['kind', 'cache', 'retryCount', ...metrics])
      || !['deep-link', 'spawn'].includes(kind) || !['cold', 'warm'].includes(data.get('cache'))
      || !Number.isSafeInteger(data.get('retryCount')) || data.get('retryCount') < 0
      || metrics.some(field => typeof data.get(field) !== 'number'
        || !Number.isFinite(data.get(field)) || data.get(field) < 0)) invalid();
    samples.push(Object.fromEntries(data));
  }
  if (samples.some(sample => sample.retryCount !== 0)) throw new CliFailure('RETRY_DETECTED');
  if (resources.some(resource => resource.name === 'https://redacted.invalid/v1/sessions')) throw new CliFailure('LEGACY_SESSION_REQUEST');
  const groups = {};
  for (const kind of ['deep-link', 'spawn']) for (const cache of ['cold', 'warm']) {
    const cohort = samples.filter(sample => sample.kind === kind && sample.cache === cache);
    if (cohort.length < 5) throw new CliFailure('INSUFFICIENT_SAMPLES');
    groups[kind + cache] = cohort;
  }
  let ok = true;
  const summaries = {};
  for (const [field, key, kind, p50, p95] of [
    ['deepLinkInteractiveMs', 'deepLink', 'deep-link', 2000, 4000],
    ['spawnRoutePaintMs', 'spawnRoutePaint', 'spawn', 7000, 10000],
    ['processorReadyMs', 'processorReady', 'spawn', 10000, 15000],
  ]) {
    summaries[key] = distribution(samples.filter(sample => sample.kind === kind).map(sample => sample[field]));
    for (const cache of ['cold', 'warm']) {
      const cohort = distribution(groups[kind + cache].map(sample => sample[field]));
      if (cohort.p50 > p50 || cohort.p95 > p95) ok = false;
    }
  }
  return { ok, sampleCount: samples.length, ...summaries, legacySessionCalls: 0 };
}

function parseArguments(argv) {
  const options = {};
  const expected = new Set(['--origin', '--session-id', '--mode', '--input']);

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!expected.has(flag) || value === undefined || value.startsWith('--') || options[flag] !== undefined) {
      throw new CliFailure('INVALID_ARGS');
    }
    options[flag] = value;
  }

  if (options['--origin'] === undefined || options['--session-id'] === undefined || options['--mode'] === undefined) {
    throw new CliFailure('INVALID_ARGS');
  }

  const origin = validateOrigin(options['--origin']);
  const sessionId = options['--session-id'];
  if (sessionId.trim() === '') {
    throw new CliFailure('INVALID_SESSION');
  }

  const mode = options['--mode'];
  if (!MODES.has(mode)) {
    throw new CliFailure('INVALID_MODE');
  }
  if (mode.startsWith('evaluate-') && options['--input'] === undefined) {
    throw new CliFailure('MISSING_INPUT');
  }
  if (mode.startsWith('print-') && options['--input'] !== undefined) {
    throw new CliFailure('INVALID_ARGS');
  }

  return { origin, sessionId, mode, input: options['--input'] };
}

function validateOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliFailure('INVALID_ORIGIN');
  }

  if (parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== '') {
    throw new CliFailure('INVALID_ORIGIN');
  }
  return parsed.origin;
}

function validateEvidence(run) {
  if (run === null || typeof run !== 'object' || Array.isArray(run)) {
    throw new CliFailure('INVALID_EVIDENCE');
  }
  if (Object.keys(run).length !== REQUIRED_EVIDENCE_FIELDS.size
    || Object.keys(run).some((key) => !REQUIRED_EVIDENCE_FIELDS.has(key))) {
    throw new CliFailure('INVALID_EVIDENCE');
  }
  if (![...REQUIRED_EVIDENCE_FIELDS].every((field) => Object.hasOwn(run, field))) {
    throw new CliFailure('INVALID_EVIDENCE');
  }
  if (!Array.isArray(run.resources)) {
    throw new CliFailure('INVALID_EVIDENCE');
  }
  for (const resource of run.resources) {
    if (resource === null || typeof resource !== 'object' || Array.isArray(resource)
      || Object.keys(resource).length !== 1 || !Object.hasOwn(resource, 'name')
      || typeof resource.name !== 'string') {
      throw new CliFailure('INVALID_EVIDENCE');
    }
    try {
      new URL(resource.name);
    } catch {
      throw new CliFailure('INVALID_EVIDENCE');
    }
  }
  for (const field of ['deepLinkInteractiveMs', 'spawnNavigateMs']) {
    if (typeof run[field] !== 'number' || !Number.isFinite(run[field]) || run[field] < 0) {
      throw new CliFailure('INVALID_EVIDENCE');
    }
  }
  return run;
}

function readEvidence(inputPath, phase2 = false) {
  let source;
  try {
    source = readFileSync(inputPath, 'utf8');
  } catch {
    throw new CliFailure('UNREADABLE_INPUT');
  }
  try {
    const parsed = JSON.parse(source);
    return phase2 ? parsed : validateEvidence(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliFailure('INVALID_JSON');
    }
    throw error;
  }
}

// Serialized into the document-start expression. All timing stays in this
// browser's performance clock; only aggregate durations cross the boundary.
function createPhase2Probe({ state, now, navigationStart, beginResourceCollection, freezeResources, requireCollection }) {
  const deep = [
    'web.root.module_ready', 'web.fonts.critical_ready', 'web.crypto.ready', 'web.credentials.ready',
    'web.route.mounted', 'web.session.snapshot_started', 'web.session.snapshot_completed',
    'web.messages.latest_started', 'web.messages.latest_completed', 'web.session.store_committed',
    'web.session.latest_message_painted',
  ];
  const spawn = [
    'web.spawn.clicked', 'web.session.hydrated', 'web.first_message.queued', 'web.session.navigated',
    'web.session.route_painted', 'web.processor.ready_received', 'web.first_agent_event_received', 'web.turn.completed',
  ];
  // Boot/font and snapshot/latest work can overlap. Validate causality, not a
  // fabricated total order; processor-ready may arrive before route paint.
  const prerequisites = {
    'web.fonts.critical_ready': ['web.root.module_ready'],
    'web.crypto.ready': ['web.root.module_ready'],
    'web.credentials.ready': ['web.crypto.ready'],
    'web.route.mounted': ['web.credentials.ready'],
    'web.session.snapshot_started': ['web.root.module_ready'],
    'web.session.snapshot_completed': ['web.session.snapshot_started'],
    'web.messages.latest_started': ['web.root.module_ready'],
    'web.messages.latest_completed': ['web.messages.latest_started'],
    'web.session.store_committed': ['web.session.snapshot_completed', 'web.messages.latest_completed'],
    'web.session.latest_message_painted': deep.slice(0, -1),
    'web.session.hydrated': ['web.spawn.clicked'],
    'web.first_message.queued': ['web.session.hydrated'],
    'web.session.navigated': ['web.first_message.queued'],
    'web.session.route_painted': ['web.session.navigated'],
    'web.processor.ready_received': ['web.spawn.clicked'],
    'web.first_agent_event_received': ['web.processor.ready_received', 'web.first_message.queued'],
    'web.turn.completed': spawn.slice(0, -1),
  };
  const allowed = new Set([...deep, ...spawn]);
  const samples = [];
  const resources = [];
  let configured = null;
  let active = null;
  let failure = null;
  const fail = code => {
    failure ??= code;
    const error = new Error(failure);
    error.code = failure;
    throw error;
  };
  const check = () => {
    if (failure) fail(failure);
    try { requireCollection(active?.path ?? {}); } catch { fail('RESOURCE_COLLECTION_FAILED'); }
  };
  const begin = kind => {
    check();
    if (active) fail('RETRY_DETECTED');
    if (!configured || configured.kind !== kind) fail('INVALID_SAMPLE');
    const key = kind === 'deep-link' ? 'deepLink' : 'spawn';
    try { beginResourceCollection(key, 'start', kind === 'deep-link' ? navigationStart : now); }
    catch { fail('RESOURCE_COLLECTION_FAILED'); }
    active = { ...configured, path: state[key], marks: new Map(), last: state[key].start, retryCount: 0 };
    configured = null;
  };
  const mark = stage => {
    check();
    if (!allowed.has(stage)) fail('INVALID_APP_STAGE');
    // Application callbacks outside an explicitly armed measurement are not samples.
    if (!active) return;
    if (!(active.kind === 'deep-link' ? deep : spawn).includes(stage)) return;
    if (active.marks.has(stage)) fail('DUPLICATE_APP_STAGE');
    let time;
    try { time = now(); } catch { fail('INVALID_APP_STAGE'); }
    if (!Number.isFinite(time) || time < active.last) fail('OUT_OF_ORDER_APP_STAGE');
    const needed = prerequisites[stage] ?? [];
    // Deep-link-only boot marks cannot substitute for any spawn milestone.
    if (needed.some(required => !active.marks.has(required))) fail('OUT_OF_ORDER_APP_STAGE');
    active.last = time;
    active.marks.set(stage, time);
    const terminal = active.kind === 'deep-link' ? 'web.session.latest_message_painted' : 'web.turn.completed';
    if (stage !== terminal) return;
    const required = active.kind === 'deep-link' ? deep : spawn;
    if (required.some(requiredStage => !active.marks.has(requiredStage))) fail('MISSING_APP_STAGE');
    try { freezeResources(active.path); } catch { fail('RESOURCE_COLLECTION_FAILED'); }
    const sample = { kind: active.kind, cache: active.cache, retryCount: active.retryCount };
    if (active.kind === 'deep-link') sample.deepLinkInteractiveMs = time - active.path.start;
    else {
      sample.spawnRoutePaintMs = active.marks.get('web.session.route_painted') - active.path.start;
      sample.processorReadyMs = active.marks.get('web.processor.ready_received') - active.path.start;
    }
    resources.push(...active.path.snapshot.map(resource => Object.freeze({ name: resource.name })));
    samples.push(Object.freeze(sample));
    active = null;
  };
  return Object.freeze({
    phase: 2,
    configureSample(value) {
      check();
      if (active || configured) fail('RETRY_DETECTED');
      try {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
          || !Object.hasOwn(value, 'kind') || !Object.hasOwn(value, 'cache')) fail('INVALID_SAMPLE');
        const { kind, cache } = value;
        if (!['deep-link', 'spawn'].includes(kind) || !['cold', 'warm'].includes(cache)) fail('INVALID_SAMPLE');
        configured = { kind, cache };
      } catch { fail('INVALID_SAMPLE'); }
    },
    initFreshDeepLink() {
      if (!configured && !active) { check(); return; }
      begin('deep-link'); mark('web.root.module_ready');
    },
    startNewTextSession() { begin('spawn'); mark('web.spawn.clicked'); },
    markAppStage: mark,
    markFreshHeaderVisible() { mark('web.route.mounted'); },
    markFreshLatestMessageComplete() { mark('web.session.latest_message_painted'); },
    markNewSessionEvent() { mark('web.session.hydrated'); },
    markLocalQueue() { mark('web.first_message.queued'); },
    markRouteNavigation() { mark('web.session.route_painted'); },
    markProcessorReady() { mark('web.processor.ready_received'); },
    markFirstAgentEvent() { mark('web.first_agent_event_received'); },
    markTurnCompletion() { mark('web.turn.completed'); },
    markRetry() {
      check();
      if (active?.kind === 'spawn') active.retryCount += 1;
    },
    collect() {
      check();
      if (active || configured || samples.length === 0) fail('MISSING_APP_STAGE');
      return Object.freeze({ resources: Object.freeze([...resources]), samples: Object.freeze([...samples]) });
    },
  });
}

function renderEgoProbe(origin, sessionId, phase2 = false) {
  return `(() => {
  const namespace = '__happySessionCriticalPathProbe';
  const invalidProbeMode = () => {
      const error = new Error('INVALID_PROBE_MODE');
      error.code = 'INVALID_PROBE_MODE';
      throw error;
  };
  let existingProbe;
  let hasExistingProbe;
  try {
    hasExistingProbe = namespace in globalThis;
    existingProbe = globalThis[namespace];
  } catch {
    invalidProbeMode();
  }
  if (${phase2} && hasExistingProbe) invalidProbeMode();
  if (existingProbe) {
    if (${phase2} !== (existingProbe.phase === 2)) invalidProbeMode();
    return existingProbe;
  }

  const state = {
    origin: ${JSON.stringify(phase2 ? null : origin)},
    sessionId: ${JSON.stringify(phase2 ? null : sessionId)},
    deepLink: {},
    spawn: {},
  };
  const now = () => performance.now();
  // ResourceTiming is delivered on completion, so an observer alone cannot
  // prove the absence of a request still in flight at either freeze boundary.
  // Install before any app script and retain initiation times independently.
  const requestStarts = [];
  let requestCollectionFailed = false;
  let trackedFetch;
  let trackedOpen;
  let trackedSend;
  let xhrPrototype;
  let installedProbe;
  const captureRequest = (input) => {
    try {
      const value = typeof input === 'string' || input instanceof URL ? input : input.url;
      const url = new URL(value, document.baseURI);
      if (url.pathname === '/v1/sessions') {
        requestStarts.push({ startTime: now(), name: 'https://redacted.invalid/v1/sessions' });
      }
    } catch {
      requestCollectionFailed = true;
    }
  };
  try {
    if (document.readyState !== 'loading' || document.scripts.length !== 0
      || typeof globalThis.fetch !== 'function' || typeof XMLHttpRequest !== 'function') {
      throw new Error();
    }
    const originalFetch = globalThis.fetch;
    xhrPrototype = XMLHttpRequest.prototype;
    const originalOpen = xhrPrototype.open;
    const originalSend = xhrPrototype.send;
    if (typeof originalOpen !== 'function' || typeof originalSend !== 'function') throw new Error();
    const xhrUrls = new WeakMap();
    trackedFetch = function (...args) {
      captureRequest(args[0]);
      return Reflect.apply(originalFetch, this, args);
    };
    trackedOpen = function (...args) {
      const result = Reflect.apply(originalOpen, this, args);
      xhrUrls.set(this, args[1]);
      return result;
    };
    trackedSend = function (...args) {
      captureRequest(xhrUrls.get(this));
      return Reflect.apply(originalSend, this, args);
    };
    globalThis.fetch = trackedFetch;
    xhrPrototype.open = trackedOpen;
    xhrPrototype.send = trackedSend;
  } catch {
    requestCollectionFailed = true;
  }
  const resourceEntries = () => performance.getEntriesByType('resource');
  const requiredMark = (value) => {
    if (typeof value !== 'number') throw new Error('Critical-path lifecycle mark is missing.');
    return value;
  };
  const requiredSnapshot = (value) => {
    if (!Array.isArray(value)) throw new Error('Critical-path lifecycle mark is missing.');
    return value;
  };
  const navigationStart = () => {
    const entry = performance.getEntriesByType('navigation')[0];
    return entry && typeof entry.startTime === 'number' ? entry.startTime : 0;
  };
  const requireCollection = (path) => {
    try {
      if (requestCollectionFailed || globalThis[namespace] !== installedProbe
        || globalThis.fetch !== trackedFetch
        || !xhrPrototype || xhrPrototype.open !== trackedOpen || xhrPrototype.send !== trackedSend) {
        requestCollectionFailed = true;
      }
    } catch {
      requestCollectionFailed = true;
    }
    if (path.collectionFailed || requestCollectionFailed) {
      const error = new Error('Critical-path resource collection failed.');
      error.code = 'RESOURCE_COLLECTION_FAILED';
      throw error;
    }
  };
  const disconnect = (path) => {
    path.closed = true;
    try {
      if (path.observer) path.observer.disconnect();
    } catch {
      path.collectionFailed = true;
    }
  };
  const failCollection = (path) => {
    path.collectionFailed = true;
    disconnect(path);
  };
  const beginResourceCollection = (key, startMark, readStart) => {
    const previous = state[key];
    const path = { resources: [], collectionFailed: false, closed: false };
    // Replace the generation before any fallible timing or observer work.
    state[key] = path;
    disconnect(previous);
    const retain = (entry) => {
      if (path.closed || !entry || typeof entry !== 'object' || typeof entry.name !== 'string'
        || typeof entry.startTime !== 'number' || entry.startTime < path.resourceStart
        || path.seenEntries.has(entry)) return;
      path.seenEntries.add(entry);
      // These legacy requests are counted at initiation, including failures and
      // requests that have not produced ResourceTiming by the freeze boundary.
      if ((entry.initiatorType === 'fetch' || entry.initiatorType === 'xmlhttprequest')
        && new URL(entry.name).pathname === '/v1/sessions') return;
      path.resources.push({ name: ${phase2 ? "new URL(entry.name).pathname === '/v1/sessions' ? 'https://redacted.invalid/v1/sessions' : 'https://redacted.invalid/resource'" : 'entry.name'} });
    };
    try {
      path[startMark] = readStart();
      path.resourceStart = path[startMark];
      path.seenEntries = new WeakSet();
      path.observer = new PerformanceObserver((list) => {
        if (path.closed) return;
        try {
          for (const entry of list.getEntries()) retain(entry);
        } catch {
          failCollection(path);
        }
      });
      path.drainResources = () => {
        for (const entry of path.observer.takeRecords()) retain(entry);
      };
      path.observer.observe({ type: 'resource' });
      for (const entry of resourceEntries()) retain(entry);
    } catch {
      failCollection(path);
    }
    requireCollection(path);
  };
  const freezeResources = (path) => {
    requireCollection(path);
    if (!Array.isArray(path.snapshot)) {
      try {
        path.drainResources();
        const end = now();
        path.snapshot = Object.freeze([
          ...path.resources,
          ...requestStarts.filter(entry => entry.startTime >= path.resourceStart && entry.startTime <= end)
            .map(entry => ({ name: entry.name })),
        ]);
      } catch {
        path.collectionFailed = true;
      } finally {
        disconnect(path);
      }
      requireCollection(path);
    }
  };
  const freezeDeepLink = () => {
    const path = state.deepLink;
    if (typeof path.headerVisible === 'number' && typeof path.latestMessageComplete === 'number') {
      freezeResources(path);
    }
  };
  const freezeSpawn = () => {
    const path = state.spawn;
    if (typeof path.turnCompletion === 'number') {
      freezeResources(path);
    }
  };

  const probe = ${phase2 ? `(${createPhase2Probe.toString()})({ state, now, navigationStart, beginResourceCollection, freezeResources, requireCollection })` : `{
    initFreshDeepLink() {
      beginResourceCollection('deepLink', 'start', navigationStart);
    },
    markFreshHeaderVisible() {
      state.deepLink.headerVisible = now();
      freezeDeepLink();
    },
    markFreshLatestMessageComplete() {
      state.deepLink.latestMessageComplete = now();
      freezeDeepLink();
    },
    startNewTextSession() {
      beginResourceCollection('spawn', 'sendClick', now);
    },
    markNewSessionEvent() { state.spawn.newSessionEvent = now(); },
    markLocalQueue() { state.spawn.localQueue = now(); },
    markRouteNavigation() {
      state.spawn.routeNavigation = now();
    },
    markFirstAgentEvent() { state.spawn.firstAgentEvent = now(); },
    markTurnCompletion() {
      state.spawn.turnCompletion = now();
      freezeSpawn();
    },
    collect() {
      const deepLink = state.deepLink;
      const spawn = state.spawn;
      requireCollection(deepLink);
      requireCollection(spawn);
      const deepLinkInteractiveMs = Math.max(
        requiredMark(deepLink.headerVisible),
        requiredMark(deepLink.latestMessageComplete),
      ) - requiredMark(deepLink.start);
      const spawnNavigateMs = requiredMark(spawn.routeNavigation) - requiredMark(spawn.sendClick);
      requiredMark(spawn.turnCompletion);
      return {
        resources: [...requiredSnapshot(deepLink.snapshot), ...requiredSnapshot(spawn.snapshot)],
        deepLinkInteractiveMs,
        spawnNavigateMs,
      };
    },
  }`};
  installedProbe = probe;
  globalThis[namespace] = probe;
  return probe;
})()`;
}

function main(argv) {
  const { origin, sessionId, mode, input } = parseArguments(argv);
  if (mode.startsWith('print-')) {
    process.stdout.write(`${renderEgoProbe(origin, sessionId, mode === 'print-phase-2-ego-probe')}\n`);
    return 0;
  }

  const phase2 = mode === 'evaluate-phase-2-json';
  const result = phase2 ? evaluatePhase2CriticalPath(readEvidence(input, true)) : evaluateCriticalPath(readEvidence(input));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

function writeFailure(error) {
  const code = error instanceof CliFailure ? error.code : 'INTERNAL_ERROR';
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code } })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    writeFailure(error);
    process.exitCode = 1;
  }
}
