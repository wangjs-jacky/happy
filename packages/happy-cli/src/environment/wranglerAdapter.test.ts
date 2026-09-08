import { describe, expect, it } from 'vitest';
import type { ProcessResult, ProcessRunner, RunProcessOptions } from './processRunner';
import {
  createWranglerAdapter,
  parseWranglerWhoami,
  type WranglerAdapterDeps,
} from './wranglerAdapter';

type Invocation = { executable: string; args: readonly string[]; options: RunProcessOptions };

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const TOKEN = 'v1.4U2JFQ9pN7xR3aL8wK6cH0mT5sD1eB';
const WHOAMI_OUTPUT = `
Getting User settings...
You are logged in with an OAuth Token, associated with the email developer@example.com.
┌──────────────────────┬──────────────────────────────────┐
│ Account Name         │ Account ID                       │
├──────────────────────┼──────────────────────────────────┤
│ Example Team         │ ${ACCOUNT_ID} │
└──────────────────────┴──────────────────────────────────┘
🔓 Token Permissions: Account Settings:Read, Workers Scripts:Edit
Config path: /Users/private/.config/.wrangler/config/default.toml
Bearer ${TOKEN}
`;

function success(stdout: string): ProcessResult {
  return { exitCode: 0, stdout, stderr: '', timedOut: false };
}

function testDeps(options: {
  wranglerPath?: string | null;
  npmPath?: string | null;
  versionResult?: ProcessResult;
  latestResult?: ProcessResult;
  whoamiResult?: ProcessResult;
} = {}): WranglerAdapterDeps & { invocations: Invocation[] } {
  const invocations: Invocation[] = [];
  const runner: ProcessRunner = {
    async run(executable, args, runOptions) {
      invocations.push({ executable, args: [...args], options: runOptions });
      if (args[0] === '--version') return options.versionResult ?? success('4.32.0\n');
      if (args[0] === 'view') return options.latestResult ?? success('"4.33.1"\n');
      if (args[0] === 'whoami') return options.whoamiResult ?? success(WHOAMI_OUTPUT);
      throw new Error(`unexpected invocation: ${executable} ${args.join(' ')}`);
    },
  };
  return {
    runner,
    resolveExecutable: async (name) => name === 'wrangler'
      ? options.wranglerPath === undefined ? '/opt/npm/bin/wrangler' : options.wranglerPath
      : options.npmPath === undefined ? '/opt/npm/bin/npm' : options.npmPath,
    env: { PATH: '/test/bin', CLOUDFLARE_API_TOKEN: TOKEN },
    platform: 'darwin', architecture: 'arm64', now: () => 1_000, invocations,
  };
}

describe('Wrangler environment adapter', () => {
  it('parses only bounded Account Name cells and drops every other whoami field', () => {
    const rows = Array.from({ length: 9 }, (_, index) => (
      `│ Account ${index + 1} │ ${String(index).repeat(32)} │`
    )).join('\n');
    const parsed = parseWranglerWhoami(`
developer@example.com
│ Account Name │ Account ID │
${rows}
│ ${'x'.repeat(129)} │ ${ACCOUNT_ID} │
Token Permissions: Workers Scripts:Edit
Bearer ${TOKEN}
`);

    expect(parsed).toEqual({
      status: 'authenticated',
      accountLabels: ['Account 1', 'Account 2', 'Account 3', 'Account 4', 'Account 5', 'Account 6', 'Account 7', 'Account 8'],
    });
    expect(JSON.stringify(parsed)).not.toMatch(/@|0123456789abcdef|Bearer|Token|Permissions|Workers|\.config/iu);
  });

  it('stops at the account table boundary before a following permissions table', () => {
    const sensitivePermission = 'Workers Scripts:Edit';
    const parsed = parseWranglerWhoami(`
│ Account Name │ Account ID │
│ Example Team │ ${ACCOUNT_ID} │
└──────────────┴──────────────────────────────────┘
│ Permission │ Scope │
│ ${sensitivePermission} │ Read │
└────────────┴───────┘
`);

    expect(parsed).toEqual({ status: 'authenticated', accountLabels: ['Example Team'] });
    expect(JSON.stringify(parsed)).not.toContain(sensitivePermission);
  });

  it('locates Account Name when a sensitive column precedes it', () => {
    const bareToken = 'oauth-token-fixture-value';
    const parsed = parseWranglerWhoami(`
│ OAuth Token │ Account Name │ Account ID │
│ ${bareToken} │ Example Team │ ${ACCOUNT_ID} │
└─────────────┴──────────────┴──────────────────────────────────┘
`);

    expect(parsed).toEqual({ status: 'authenticated', accountLabels: ['Example Team'] });
    expect(JSON.stringify(parsed)).not.toContain(bareToken);
  });

  it.each([
    ['bare token-shaped label', 'v1.4U2JFQ9pN7xR3aL8wK6cH0mT5sD1eB'],
    ['malformed config-path row', '~/.config/wrangler/default.toml'],
  ])('rejects a %s from Account Name', (_name, sensitiveLabel) => {
    const parsed = parseWranglerWhoami(`
│ Account Name │ Account ID │
│ ${sensitiveLabel} │ ${ACCOUNT_ID} │
└──────────────┴──────────────────────────────────┘
`);

    expect(parsed).toEqual({ status: 'authenticated' });
    expect(JSON.stringify(parsed)).not.toContain(sensitiveLabel);
  });

  it('counts an oversized Account Name among the first eight candidates', () => {
    const oversizedLabel = 'x'.repeat(129);
    const rows = [oversizedLabel, ...Array.from({ length: 8 }, (_, index) => `Account ${index + 2}`)]
      .map((label, index) => `│ ${label} │ ${String(index).repeat(32)} │`)
      .join('\n');

    const parsed = parseWranglerWhoami(`
│ Account Name │ Account ID │
${rows}
└──────────────┴──────────────────────────────────┘
`);

    expect(parsed).toEqual({
      status: 'authenticated',
      accountLabels: ['Account 2', 'Account 3', 'Account 4', 'Account 5', 'Account 6', 'Account 7', 'Account 8'],
    });
    expect(JSON.stringify(parsed)).not.toContain(oversizedLabel);
    expect(JSON.stringify(parsed)).not.toContain('Account 9');
  });

  it('never serializes rejected Account Name values in an observation', async () => {
    const bareToken = 'oauth-token-fixture-value';
    const configPath = '~/.config/wrangler/default.toml';
    const oversizedLabel = 'x'.repeat(129);
    const deps = testDeps({
      whoamiResult: success(`
│ OAuth Token │ Account Name │ Account ID │
│ ${TOKEN} │ Safe Team │ ${ACCOUNT_ID} │
│ ignored │ ${bareToken} │ ${ACCOUNT_ID} │
│ ignored │ ${configPath} │ ${ACCOUNT_ID} │
│ ignored │ ${oversizedLabel} │ ${ACCOUNT_ID} │
└─────────────┴──────────────┴──────────────────────────────────┘
│ Permission │ Scope │
│ Workers Scripts:Edit │ Read │
`),
    });

    const observed = await createWranglerAdapter(deps).inspect();
    const serialized = JSON.stringify(observed);

    expect(observed.authentication).toEqual({
      provider: 'cloudflare', status: 'authenticated', accountLabels: ['Safe Team'],
    });
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(ACCOUNT_ID);
    expect(serialized).not.toContain(bareToken);
    expect(serialized).not.toContain(configPath);
    expect(serialized).not.toContain(oversizedLabel);
    expect(serialized).not.toContain('Workers Scripts:Edit');
  });

  it('returns only sanitized auth status and account labels from inspection', async () => {
    const deps = testDeps();
    const adapter = createWranglerAdapter(deps);

    const observed = await adapter.inspect();

    expect(adapter.alignment).toBe('inspect-only');
    expect(observed).toMatchObject({
      componentId: 'cloudflare-wrangler', installed: true, installedVersion: '4.32.0',
      resolvedExecutable: '/opt/npm/bin/wrangler',
      source: { kind: 'npm-global', available: true, latestVersion: '4.33.1', ownership: 'not-applicable' },
      capability: 'inspect-only',
      authentication: { provider: 'cloudflare', status: 'authenticated', accountLabels: ['Example Team'] },
      details: { kind: 'cloudflare-wrangler' }, inspectedAt: 1_000,
    });
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toMatch(/@|0123456789abcdef|Bearer|Token|Permissions|Workers|\/Users\/private|stdout|stderr/iu);
    expect(deps.invocations).toEqual([
      expect.objectContaining({ executable: '/opt/npm/bin/wrangler', args: ['--version'] }),
      expect.objectContaining({ executable: '/opt/npm/bin/npm', args: ['view', 'wrangler', 'version', '--json'] }),
      expect.objectContaining({ executable: '/opt/npm/bin/wrangler', args: ['whoami'] }),
    ]);
    expect(deps.invocations.every(({ options }) => (
      options.timeoutMs === 15_000 && options.maxOutputBytes === 64 * 1024
    ))).toBe(true);
  });

  it('reports unauthenticated whoami without returning its output', async () => {
    const deps = testDeps({
      whoamiResult: {
        exitCode: 1, stdout: 'You are not authenticated. Run wrangler login.',
        stderr: `developer@example.com ${ACCOUNT_ID} ${TOKEN}`, timedOut: false,
      },
    });

    const observed = await createWranglerAdapter(deps).inspect();

    expect(observed).toMatchObject({
      installedVersion: '4.32.0', authentication: { provider: 'cloudflare', status: 'missing' },
      reasonCode: 'authentication-missing',
    });
    expect(JSON.stringify(observed)).not.toMatch(/@|0123456789abcdef|4U2JFQ9|stdout|stderr/u);
  });

  it.each(['fetch failed', 'Cloudflare API returned 503', 'unrecognized failure']) (
    'keeps authentication unknown after a nonzero whoami exit: %s', async (failure) => {
      const observed = await createWranglerAdapter(testDeps({ whoamiResult: {
        exitCode: 1, stdout: WHOAMI_OUTPUT, stderr: `${failure} ${TOKEN}`, timedOut: false,
      } })).inspect();
      expect(observed).toMatchObject({ installedVersion: '4.32.0',
        authentication: { provider: 'cloudflare', status: 'unknown' }, reasonCode: 'unexpected-error' });
      expect(observed.authentication?.accountLabels).toBeUndefined();
      expect(JSON.stringify(observed)).not.toMatch(/@|0123456789abcdef|4U2JFQ9|stdout|stderr|503|fetch/u);
    },
  );

  it('recognizes unauthenticated stderr without leaking it', async () => {
    const observed = await createWranglerAdapter(testDeps({ whoamiResult: {
      exitCode: 1, stdout: '', stderr: `You are not logged in. ${TOKEN}`, timedOut: false,
    } })).inspect();
    expect(observed.authentication).toEqual({ provider: 'cloudflare', status: 'missing' });
    expect(JSON.stringify(observed)).not.toContain(TOKEN);
  });

  it.each([
    ['latest version', { latestResult: { exitCode: null, stdout: TOKEN, stderr: 'network failed', timedOut: true } }],
    ['whoami', { whoamiResult: { exitCode: null, stdout: WHOAMI_OUTPUT, stderr: TOKEN, timedOut: true } }],
  ] satisfies ReadonlyArray<readonly [string, Parameters<typeof testDeps>[0]]>) (
    'preserves the local version when %s times out', async (_name, options) => {
      const observed = await createWranglerAdapter(testDeps(options)).inspect();

      expect(observed).toMatchObject({ installed: true, installedVersion: '4.32.0', reasonCode: 'process-timeout' });
      expect(JSON.stringify(observed)).not.toMatch(/@|0123456789abcdef|4U2JFQ9|stdout|stderr/u);
      if ('latestResult' in options) expect(observed.source.latestVersion).toBeNull();
      if ('whoamiResult' in options) expect(observed.authentication).toEqual({ provider: 'cloudflare', status: 'unknown' });
    },
  );
});
