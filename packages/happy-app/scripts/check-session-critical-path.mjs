import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MODES = new Set(['evaluate-json', 'print-ego-probe']);
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
  if (mode === 'evaluate-json' && options['--input'] === undefined) {
    throw new CliFailure('MISSING_INPUT');
  }
  if (mode === 'print-ego-probe' && options['--input'] !== undefined) {
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

function readEvidence(inputPath) {
  let source;
  try {
    source = readFileSync(inputPath, 'utf8');
  } catch {
    throw new CliFailure('UNREADABLE_INPUT');
  }
  try {
    return validateEvidence(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliFailure('INVALID_JSON');
    }
    throw error;
  }
}

function renderEgoProbe(origin, sessionId) {
  return `(() => {
  const namespace = '__happySessionCriticalPathProbe';
  if (globalThis[namespace]) return globalThis[namespace];

  const state = {
    origin: ${JSON.stringify(origin)},
    sessionId: ${JSON.stringify(sessionId)},
    marks: {},
  };
  const now = () => performance.now();
  const mark = (name) => { state.marks[name] = now(); };
  const requiredMark = (name) => {
    if (typeof state.marks[name] !== 'number') throw new Error('Critical-path lifecycle mark is missing.');
    return state.marks[name];
  };
  const navigationStart = () => {
    const entry = performance.getEntriesByType('navigation')[0];
    return entry && typeof entry.startTime === 'number' ? entry.startTime : 0;
  };

  const probe = {
    initFreshDeepLink() { state.marks.deepLinkStart = navigationStart(); },
    markFreshHeaderVisible() { mark('freshHeaderVisible'); },
    markFreshLatestMessageComplete() { mark('freshLatestMessageComplete'); },
    startNewTextSession() { mark('newSessionSendClick'); },
    markNewSessionEvent() { mark('newSessionEvent'); },
    markLocalQueue() { mark('localQueue'); },
    markRouteNavigation() { mark('routeNavigation'); },
    markFirstAgentEvent() { mark('firstAgentEvent'); },
    markTurnCompletion() { mark('turnCompletion'); },
    collect() {
      const deepLinkInteractiveMs = Math.max(
        requiredMark('freshHeaderVisible'),
        requiredMark('freshLatestMessageComplete'),
      ) - requiredMark('deepLinkStart');
      const spawnNavigateMs = requiredMark('routeNavigation') - requiredMark('newSessionSendClick');
      return {
        resources: performance.getEntriesByType('resource').map(({ name }) => ({ name })),
        deepLinkInteractiveMs,
        spawnNavigateMs,
      };
    },
  };
  globalThis[namespace] = probe;
  return probe;
})()`;
}

function main(argv) {
  const { origin, sessionId, mode, input } = parseArguments(argv);
  if (mode === 'print-ego-probe') {
    process.stdout.write(`${renderEgoProbe(origin, sessionId)}\n`);
    return 0;
  }

  const result = evaluateCriticalPath(readEvidence(input));
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
