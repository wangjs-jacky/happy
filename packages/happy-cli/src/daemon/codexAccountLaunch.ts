import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiClient } from '@/api/api';
import { CodexAccountRequestError, type CodexGrantRedemption } from '@/api/codexAccountTypes';
import { codexAccountAuthSchema, readCodexAccountAuth, type CodexAccountAuth } from '@/codex/codexAccountAuth';
import { prepareCodexHomeWithAuth } from '@/codex/codexHome';
import { collectCodexUsageSnapshot } from '@/codex/codexUsage';
import { retainCodexAccountHistory, restoreCodexAccountHistory, rememberCodexAccountSession, copyCodexSourceThread, CodexSourceHistoryUnavailableError } from '@/codex/codexAccountHistory';
import { configuration } from '@/configuration';
import type { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';

type AccountApi = Pick<ApiClient, 'redeemCodexSessionGrant' | 'attachCodexSession' | 'updateCodexAccountCredential' | 'reportCodexAccountQuota' | 'reportCodexAccountStatus'>;
type PrepareOptions = NonNullable<Parameters<typeof prepareCodexHomeWithAuth>[1]> & { historyRoot?: string; sourceSessionId?: string; sourceThreadId?: string };
const fingerprint = (auth: CodexAccountAuth) => createHash('sha256').update(JSON.stringify(auth)).digest('hex');

/** One redeemed launch owns one home and immutable quota attribution. */
export class CodexAccountLaunch {
  readonly profileId: string;
  readonly launchId: string;
  readonly credentialVersion: number;
  private currentVersion: number;
  private authFingerprint: string;
  private readonly accountId: string;
  private sourceSessionId?: string;
  private timer?: NodeJS.Timeout;
  private pending: Promise<void> = Promise.resolve();
  private finishing?: Promise<void>;
  private writeDisabled = false;
  private lastQuota?: string;
  private pid?: number;
  private readonly startedAt = Date.now();
  private identityInvalid = false;

  private constructor(private readonly api: AccountApi, private readonly machineId: string, readonly home: string, grant: CodexGrantRedemption, private readonly historyRoot: string) {
    this.profileId = grant.profile.id; this.launchId = grant.launchId;
    this.credentialVersion = this.currentVersion = grant.profile.credentialVersion;
    this.authFingerprint = fingerprint(grant.auth); this.accountId = grant.auth.tokens.account_id;
  }

  static async prepare(api: AccountApi, machineId: string, grant: string | undefined, options?: PrepareOptions): Promise<CodexAccountLaunch> {
    if (typeof grant !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(grant)) throw new Error('A fresh Codex session grant is required. Check the device Codex account binding.');
    const redeemed = await api.redeemCodexSessionGrant({ machineId, grant });
    const parsed = codexAccountAuthSchema.safeParse(redeemed.auth);
    if (!parsed.success || !redeemed.launchId || !redeemed.profile?.id || !Number.isInteger(redeemed.profile.credentialVersion) || redeemed.profile.credentialVersion < 1) {
      throw new Error('Invalid Codex grant response');
    }
    const home = await prepareCodexHomeWithAuth(JSON.stringify(parsed.data), options);
    const historyRoot = options?.historyRoot ?? join(configuration.happyHomeDir, 'codex-session-cache');
    try {
      await restoreCodexAccountHistory(historyRoot, redeemed.profile.id, home);
      if (options?.sourceThreadId) await copyCodexSourceThread(historyRoot, options.sourceSessionId ?? '', options.sourceThreadId, home);
      await writeFile(join(home, '.paws-account-launch.json'), JSON.stringify({ daemonPid: process.pid, profileId: redeemed.profile.id, historyRoot }), { mode: 0o600, flag: 'wx' });
    }
    catch (error) { await rm(home, { recursive: true, force: true }); throw error instanceof CodexSourceHistoryUnavailableError ? error : new Error('Unable to restore Codex session history'); }
    return new CodexAccountLaunch(api, machineId, home, { ...redeemed, auth: parsed.data }, historyRoot);
  }

  environment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...base, CODEX_HOME: this.home, HAPPY_CODEX_APP_SERVER_MODE: 'spawn',
      HAPPY_CODEX_ACCOUNT_PROFILE_ID: this.profileId, HAPPY_CODEX_ACCOUNT_CREDENTIAL_VERSION: String(this.credentialVersion),
    };
    delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; delete env.HAPPY_CODEX_APP_SERVER_SOCKET;
    return env;
  }

  trackProcess(pid: number): void { this.pid = pid; }

  async attach(sourceSessionId: string): Promise<void> {
    if (this.finishing) throw new Error('Codex process exited before session attachment');
    await this.api.attachCodexSession(this.launchId, { machineId: this.machineId, sourceSessionId });
    await rememberCodexAccountSession(this.historyRoot, sourceSessionId, this.profileId, this.home);
    this.sourceSessionId = sourceSessionId;
    this.timer = setInterval(() => { void this.sync(); }, 60_000);
    this.timer.unref();
  }

  async reportStatus(status: 'needs-refresh' | 'invalid'): Promise<void> {
    if (!this.sourceSessionId || this.writeDisabled) return;
    try {
      await this.api.reportCodexAccountStatus(this.profileId, { machineId: this.machineId, launchId: this.launchId, credentialVersion: this.currentVersion, status });
    } catch { /* Status cannot interrupt the running session; no raw error logging. */ }
  }

  sync(): Promise<void> {
    if (this.finishing) return this.finishing;
    this.pending = this.pending.then(() => this.syncOnce()).catch(() => undefined);
    return this.pending;
  }

  private async syncOnce(): Promise<void> {
    if (!this.sourceSessionId) return;
    if (!this.writeDisabled) {
      let auth: CodexAccountAuth | undefined;
      try { auth = await readCodexAccountAuth(this.home); }
      catch { await this.reportStatus('needs-refresh'); }
      if (auth && auth.tokens.account_id !== this.accountId) {
        await this.reportStatus('invalid'); this.writeDisabled = true; this.identityInvalid = true;
      } else if (auth && fingerprint(auth) !== this.authFingerprint) {
        try {
          const result = await this.api.updateCodexAccountCredential(this.profileId, { machineId: this.machineId, launchId: this.launchId, expectedVersion: this.currentVersion, auth });
          this.currentVersion = result.profile.credentialVersion;
          this.authFingerprint = fingerprint(auth);
        } catch (error) {
          if (error instanceof CodexAccountRequestError && ['credential-version-conflict', 'profile-not-found', 'launch-unavailable', 'credential-identity-mismatch'].includes(error.code)) this.writeDisabled = true;
        }
      }
    }
    if (this.identityInvalid) return;
    try {
      const snapshot = await collectCodexUsageSnapshot({ codexHome: this.home, maxDays: 8 });
      const event = snapshot.latestEvent;
      const secondary = event?.rateLimits?.secondary;
      const observed = event?.rateLimitsTimestamp;
      if (typeof secondary?.usedPercent !== 'number' || !Number.isFinite(secondary.usedPercent) || secondary.usedPercent < 0 || secondary.usedPercent > 100 ||
          typeof secondary.resetsAt !== 'number' || !Number.isFinite(secondary.resetsAt) || !observed || !Number.isFinite(Date.parse(observed)) || Date.parse(observed) < this.startedAt) return;
      if (secondary.windowMinutes !== undefined && secondary.windowMinutes !== 10080) return;
      const reset = new Date(secondary.resetsAt * 1000);
      if (!Number.isFinite(reset.getTime()) || reset.getTime() <= Date.parse(observed)) return;
      const signature = JSON.stringify([secondary.usedPercent, secondary.resetsAt, observed]);
      if (signature === this.lastQuota) return;
      await this.api.reportCodexAccountQuota(this.profileId, {
        machineId: this.machineId, launchId: this.launchId, sourceSessionId: this.sourceSessionId,
        credentialVersion: this.credentialVersion, weeklyUsedPercent: secondary.usedPercent,
        weeklyResetsAt: reset.toISOString(), observedAt: observed,
      });
      this.lastQuota = signature;
    } catch { /* Retry next minute; never publish warnings or provider error text. */ }
  }

  finish(): Promise<void> {
    if (!this.finishing) {
      clearInterval(this.timer);
      this.finishing = this.pending.then(() => this.syncOnce()).catch(() => undefined)
        .then(async () => {
          try { if (this.sourceSessionId && !this.identityInvalid) await retainCodexAccountHistory(this.historyRoot, this.profileId, this.home); }
          finally { await rm(this.home, { recursive: true, force: true }); }
        });
    }
    return this.finishing;
  }

  async abort(): Promise<void> {
    if (this.pid) { try { process.kill(this.pid, 'SIGTERM'); } catch { /* Already gone. */ } }
    await this.finish();
  }
}

export async function withCodexAccountLaunch(
  options: Pick<SpawnSessionOptions, 'agent' | 'codexSessionGrant' | 'token'>,
  api: AccountApi, machineId: string,
  spawn: (launch: CodexAccountLaunch | undefined) => Promise<SpawnSessionResult>,
  prepareOptions?: PrepareOptions,
): Promise<SpawnSessionResult> {
  if (options.agent !== 'codex') return spawn(undefined);
  let launch: CodexAccountLaunch | undefined;
  try {
    launch = await CodexAccountLaunch.prepare(api, machineId, options.codexSessionGrant, prepareOptions);
    const result = await spawn(launch);
    if (result.type === 'success') await launch.attach(result.sessionId);
    else await launch.abort();
    return result;
  } catch (error) {
    await launch?.abort().catch(() => undefined);
    return { type: 'error', errorMessage: error instanceof CodexSourceHistoryUnavailableError ? error.message : 'Codex account launch failed. Check the device account binding and request a fresh session grant.' };
  }
}
