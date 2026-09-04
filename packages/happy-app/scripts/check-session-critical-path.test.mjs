import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath = new URL('./check-session-critical-path.mjs', import.meta.url);
const origin = 'https://example.test';
const sessionId = 'known-session-123';

function passingRun(overrides = {}) {
  return {
    resources: [{ name: 'https://example.test/v1/session/known-session-123' }],
    deepLinkInteractiveMs: 2_000,
    spawnNavigateMs: 7_000,
    ...overrides,
  };
}

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

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath.pathname, ...args], {
    encoding: 'utf8',
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
  const result = evaluateCriticalPath(passingRun({ deepLinkInteractiveMs: 2_001 }));

  assert.equal(result.ok, false);
  assert.equal(result.deepLinkInteractiveMs, 2_001);
});

test('fails a new-session navigation that takes more than 7000ms', async () => {
  const { evaluateCriticalPath } = await evaluator();
  const result = evaluateCriticalPath(passingRun({ spawnNavigateMs: 7_001 }));

  assert.equal(result.ok, false);
  assert.equal(result.spawnNavigateMs, 7_001);
});

test('evaluate-json prints the evaluator result and rejects malformed evidence', async () => {
  await withMeasurement(JSON.stringify(passingRun()), async (inputPath) => {
    const result = runCli([
      '--origin', origin,
      '--session-id', sessionId,
      '--mode', 'evaluate-json',
      '--input', inputPath,
    ]);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      legacySessionCalls: 0,
      deepLinkInteractiveMs: 2_000,
      spawnNavigateMs: 7_000,
    });
  });

  await withMeasurement('{', async (inputPath) => {
    const result = runCli([
      '--origin', origin,
      '--session-id', sessionId,
      '--mode', 'evaluate-json',
      '--input', inputPath,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Invalid measurement JSON:/);
  });

  await withMeasurement(JSON.stringify({ resources: [] }), async (inputPath) => {
    const result = runCli([
      '--origin', origin,
      '--session-id', sessionId,
      '--mode', 'evaluate-json',
      '--input', inputPath,
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'Invalid measurement evidence: missing deepLinkInteractiveMs\n');
  });

  await withMeasurement(JSON.stringify(passingRun({
    resources: [{ name: 'not a URL' }],
  })), async (inputPath) => {
    const result = runCli([
      '--origin', origin,
      '--session-id', sessionId,
      '--mode', 'evaluate-json',
      '--input', inputPath,
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, 'Invalid measurement evidence: resources[0].name must be an absolute URL\n');
  });
});

test('rejects invalid CLI origin, missing evaluate input, and forbidden evidence', async () => {
  const missingOrigin = runCli([]);
  assert.equal(missingOrigin.status, 1);
  assert.equal(missingOrigin.stderr, 'Missing required --origin\n');

  const invalidOrigin = runCli([
    '--origin', 'http://example.test',
    '--session-id', sessionId,
    '--mode', 'print-ego-probe',
  ]);
  assert.equal(invalidOrigin.status, 1);
  assert.equal(invalidOrigin.stderr, 'Invalid --origin: expected an HTTPS origin without path, query, or fragment\n');

  const credentialedOrigin = runCli([
    '--origin', 'https://user:password@example.test',
    '--session-id', sessionId,
    '--mode', 'print-ego-probe',
  ]);
  assert.equal(credentialedOrigin.status, 1);
  assert.equal(credentialedOrigin.stderr, 'Invalid --origin: expected an HTTPS origin without path, query, or fragment\n');

  const missingInput = runCli([
    '--origin', origin,
    '--session-id', sessionId,
    '--mode', 'evaluate-json',
  ]);
  assert.equal(missingInput.status, 1);
  assert.equal(missingInput.stderr, 'Missing required --input for --mode evaluate-json\n');

  await withMeasurement(JSON.stringify(passingRun({
    resources: [{ name: 'https://example.test/v1/sessions' }],
  })), async (inputPath) => {
    const result = runCli([
      '--origin', origin,
      '--session-id', sessionId,
      '--mode', 'evaluate-json',
      '--input', inputPath,
    ]);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).legacySessionCalls, 1);
  });
});

test('print-ego-probe provides only resource and timing collection without credentials or writes', () => {
  const result = runCli([
    '--origin', origin,
    '--session-id', sessionId,
    '--mode', 'print-ego-probe',
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /performance\.getEntriesByType\('resource'\)/);
  assert.match(result.stdout, /deepLinkInteractiveMs/);
  assert.match(result.stdout, /spawnNavigateMs/);
  assert.match(result.stdout, /https:\/\/example\.test/);
  assert.match(result.stdout, /known-session-123/);
  assert.doesNotMatch(result.stdout, /localStorage|sessionStorage|document\.cookie|authorization|bearer|password|fetch\(|XMLHttpRequest|send\(/i);
});
