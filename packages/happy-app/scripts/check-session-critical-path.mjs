import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MODES = new Set(['evaluate-json', 'print-ego-probe']);
const REQUIRED_EVIDENCE_FIELDS = new Set([
  'resources',
  'deepLinkInteractiveMs',
  'spawnNavigateMs',
]);

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
    if (!expected.has(flag)) {
      throw new Error(`Unknown argument: ${flag ?? '(missing)'}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (options[flag] !== undefined) {
      throw new Error(`Duplicate argument: ${flag}`);
    }
    options[flag] = value;
  }

  for (const flag of ['--origin', '--session-id', '--mode']) {
    if (options[flag] === undefined) {
      throw new Error(`Missing required ${flag}`);
    }
  }

  const origin = validateOrigin(options['--origin']);
  const sessionId = options['--session-id'];
  if (sessionId.trim() === '') {
    throw new Error('Invalid --session-id: expected a non-empty value');
  }

  const mode = options['--mode'];
  if (!MODES.has(mode)) {
    throw new Error('Invalid --mode: expected evaluate-json or print-ego-probe');
  }
  if (mode === 'evaluate-json' && options['--input'] === undefined) {
    throw new Error('Missing required --input for --mode evaluate-json');
  }
  if (mode === 'print-ego-probe' && options['--input'] !== undefined) {
    throw new Error('--input is only valid for --mode evaluate-json');
  }

  return { origin, sessionId, mode, input: options['--input'] };
}

function validateOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid --origin: expected an HTTPS origin without path, query, or fragment');
  }

  if (parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== '') {
    throw new Error('Invalid --origin: expected an HTTPS origin without path, query, or fragment');
  }
  return parsed.origin;
}

function validateEvidence(run) {
  if (run === null || typeof run !== 'object' || Array.isArray(run)) {
    throw new Error('Invalid measurement evidence: expected an object');
  }
  for (const key of Object.keys(run)) {
    if (!REQUIRED_EVIDENCE_FIELDS.has(key)) {
      throw new Error(`Invalid measurement evidence: unexpected field ${key}`);
    }
  }
  for (const field of REQUIRED_EVIDENCE_FIELDS) {
    if (!(field in run)) {
      throw new Error(`Invalid measurement evidence: missing ${field}`);
    }
  }
  if (!Array.isArray(run.resources)) {
    throw new Error('Invalid measurement evidence: resources must be an array');
  }
  for (const [index, resource] of run.resources.entries()) {
    if (resource === null || typeof resource !== 'object' || Array.isArray(resource)
      || Object.keys(resource).length !== 1 || !Object.hasOwn(resource, 'name')
      || typeof resource.name !== 'string') {
      throw new Error(`Invalid measurement evidence: resources[${index}] must contain only a string name`);
    }
    try {
      new URL(resource.name);
    } catch {
      throw new Error(`Invalid measurement evidence: resources[${index}].name must be an absolute URL`);
    }
  }
  for (const field of ['deepLinkInteractiveMs', 'spawnNavigateMs']) {
    if (typeof run[field] !== 'number' || !Number.isFinite(run[field])) {
      throw new Error(`Invalid measurement evidence: ${field} must be a finite number`);
    }
    if (run[field] < 0) {
      throw new Error(`Invalid measurement evidence: ${field} must be non-negative`);
    }
  }
  return run;
}

function readEvidence(inputPath) {
  let source;
  try {
    source = readFileSync(inputPath, 'utf8');
  } catch {
    throw new Error(`Unable to read measurement input: ${inputPath}`);
  }
  try {
    return validateEvidence(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid measurement JSON: ${error.message}`);
    }
    throw error;
  }
}

function renderEgoProbe(origin, sessionId) {
  return `(() => {
  const origin = ${JSON.stringify(origin)};
  const sessionId = ${JSON.stringify(sessionId)};
  const timings = globalThis.__happySessionCriticalPathTimings;

  if (!timings || typeof timings.deepLinkInteractiveMs !== 'number'
    || typeof timings.spawnNavigateMs !== 'number') {
    throw new Error('Set the two critical-path timing values before collecting evidence.');
  }

  return {
    resources: performance.getEntriesByType('resource').map(({ name }) => ({ name })),
    deepLinkInteractiveMs: timings.deepLinkInteractiveMs,
    spawnNavigateMs: timings.spawnNavigateMs,
  };
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
