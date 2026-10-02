import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RunError } from '../server/runs.js';
import { DEFAULT_CODEX_EFFORT, DEFAULT_CODEX_MODEL, isCodexEffort, isCodexModel, type CodexEffort, type CodexModel } from './codex-profile.js';
import type { RoomMember } from './routing.js';

/** The first group-chat release deliberately launches only Codex agents. */
export { DEFAULT_CODEX_EFFORT, DEFAULT_CODEX_MODEL, type CodexEffort, type CodexModel } from './codex-profile.js';
export type AgentProfile = RoomMember & {
  engine: 'codex';
  model: CodexModel;
  effort: CodexEffort;
  avatarId: number;
  machineId?: string;
  directory?: string;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  skills?: Array<{ name: string; path?: string; reason: string }>;
  preferences?: string;
  setupNotes?: string;
  archived?: boolean;
  sessions?: Array<{ sessionId: string; title: string; createdAt: number }>;
  creationRequestId?: string;
  creationFingerprint?: string;
};
export type AgentProfileInput = {
  name: string;
  instructions: string;
  model?: CodexModel;
  effort?: CodexEffort;
  avatarId?: number;
  machineId?: string;
  directory?: string;
  /** Rejected when supplied with anything other than Codex, for a clear API error. */
  engine?: unknown;
  expectedUpdatedAt?: number;
};
type ProfilesFile = { profiles: AgentProfile[] };

export class ProfileService {
  private readonly profiles = new Map<string, AgentProfile>();
  private persistQueue: Promise<void> = Promise.resolve();
  private mutationQueue: Promise<void> = Promise.resolve();
  private migratedLegacyProfiles = false;

  private constructor(private readonly path: string, file: ProfilesFile) {
    for (const profile of file.profiles ?? []) {
      const normalized = normalizeStoredProfile(profile);
      if (!sameProfile(profile, normalized)) this.migratedLegacyProfiles = true;
      this.profiles.set(normalized.id, normalized);
    }
  }

  static async create(dataDir: string): Promise<ProfileService> {
    const path = join(dataDir, 'group-chat-profiles.json');
    let file: ProfilesFile = { profiles: [] };
    try { file = JSON.parse(await readFile(path, 'utf8')) as ProfilesFile; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const service = new ProfileService(path, file);
    if (service.profiles.size === 0) {
      await Promise.all([
        service.create({ name: '产品经理', instructions: '澄清用户目标、范围和验收标准，关注产品价值。' }),
        service.create({ name: '技术负责人', instructions: '评估实现路径、工程成本、系统约束与风险。' }),
        service.create({ name: '质疑者', instructions: '寻找漏洞、反例、遗漏假设和不可逆风险。' }),
      ]);
    } else if (service.migratedLegacyProfiles) await service.persist();
    return service;
  }

  list(): AgentProfile[] { return [...this.profiles.values()].map(clone).sort((a, b) => a.createdAt - b.createdAt); }
  get(id: string): AgentProfile { const value = this.profiles.get(id); if (!value) throw new RunError(404, 'Agent profile not found.'); return clone(value); }

  async create(input: AgentProfileInput): Promise<AgentProfile> {
    return this.mutate(async () => {
    const normalized = normalize(input);
    this.assertNameAvailable(normalized.name);
    const timestamp = Date.now();
    const profile: AgentProfile = { id: `agent-${randomUUID().replaceAll('-', '').slice(0, 16)}`, ...normalized, createdAt: timestamp, updatedAt: timestamp };
    this.profiles.set(profile.id, profile);
    await this.persist();
    return clone(profile);
    });
  }

  async update(id: string, input: AgentProfileInput): Promise<AgentProfile> {
    return this.mutate(async () => {
    const current = this.profiles.get(id); if (!current) throw new RunError(404, 'Agent profile not found.');
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== current.updatedAt) throw new RunError(409, 'Agent 已被修改，请重新读取后再保存。');
    const normalized = normalize(input);
    this.assertNameAvailable(normalized.name, id);
    Object.assign(current, normalized, { updatedAt: Math.max(Date.now(), current.updatedAt + 1) });
    await this.persist();
    return clone(current);
    });
  }

  async saveMyAgent(input: Record<string, unknown>, id?: string): Promise<AgentProfile> {
    return this.mutate(async () => {
    const requestId = boundedString(input.requestId, 'requestId', 128, true);
    const definition = normalizeMyAgent(input);
    if (!id) {
      const fingerprint = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
      const prior = this.list().find(p => p.creationRequestId === requestId);
      if (prior) {
        if (prior.creationFingerprint !== fingerprint) throw new RunError(409, '创建请求已用于其他配置。');
        return prior;
      }
      this.assertNameAvailable(definition.name);
      const now = Date.now();
      const profile: AgentProfile = { id: `agent-${randomUUID().replaceAll('-', '').slice(0, 16)}`, ...definition, createdAt: now, updatedAt: now, sessions: [], archived: false, creationRequestId: requestId, creationFingerprint: fingerprint };
      this.profiles.set(profile.id, profile);
      try { await this.persist(); } catch (error) { this.profiles.delete(profile.id); throw error; }
      return clone(profile);
    }
    const current = this.get(id);
    if (typeof input.expectedUpdatedAt !== 'number' || input.expectedUpdatedAt !== current.updatedAt) throw new RunError(409, 'Agent 已被修改，请重新读取后再保存。');
    this.assertNameAvailable(definition.name, id);
    const next = { ...current, ...definition, updatedAt: Math.max(Date.now(), current.updatedAt + 1) };
    this.profiles.set(id, next);
    try { await this.persist(); } catch (error) { this.profiles.set(id, current); throw error; }
    return clone(next);
    });
  }

  async recordSession(id: string, input: Record<string, unknown>): Promise<AgentProfile> {
    return this.mutate(async () => {
    const current = this.get(id);
    const sessionId = boundedString(input.sessionId, 'sessionId', 128, true);
    const title = boundedString(input.title ?? current.name, 'title', 240);
    if (current.sessions?.some(s => s.sessionId === sessionId)) return current;
    const next = { ...current, sessions: [{ sessionId, title, createdAt: Date.now() }, ...(current.sessions ?? [])].slice(0, 100) };
    this.profiles.set(id, next);
    try { await this.persist(); } catch (error) { this.profiles.set(id, current); throw error; }
    return clone(next);
    });
  }

  async archiveMyAgent(id: string, input: Record<string, unknown>): Promise<AgentProfile> {
    return this.mutate(async () => {
    const current = this.get(id);
    if (input.expectedUpdatedAt !== current.updatedAt) throw new RunError(409, 'Agent 已被修改，请刷新后重试。');
    if (typeof input.archived !== 'boolean') throw new RunError(400, 'archived must be boolean');
    const next = { ...current, archived: input.archived, updatedAt: Math.max(Date.now(), current.updatedAt + 1) };
    this.profiles.set(id, next);
    try { await this.persist(); } catch (error) { this.profiles.set(id, current); throw error; }
    return clone(next);
    });
  }

  members(ids: string[]): AgentProfile[] {
    if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) throw new RunError(400, 'Choose one or more distinct agents.');
    return ids.map(id => { const p = this.get(id); if (p.archived) throw new RunError(409, 'Agent 已归档，请先恢复。'); return p; });
  }

  private assertNameAvailable(name: string, exceptId?: string): void {
    if (this.list().some(profile => profile.id !== exceptId && profile.name === name)) throw new RunError(409, 'Agent display names must be unique.');
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationQueue.then(async () => {
      const previous = this.list();
      try { return await operation(); }
      catch (error) { this.profiles.clear(); for (const p of previous) this.profiles.set(p.id, p); throw error; }
    });
    this.mutationQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  private persist(): Promise<void> {
    const payload: ProfilesFile = { profiles: this.list() };
    this.persistQueue = this.persistQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
      await rename(temp, this.path); await chmod(this.path, 0o600);
    });
    return this.persistQueue;
  }
}

export function normalizeProfileInput(input: AgentProfileInput): Pick<AgentProfile, 'name' | 'instructions' | 'engine' | 'model' | 'effort' | 'avatarId' | 'machineId' | 'directory'> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.name !== 'string' || typeof input.instructions !== 'string') throw new RunError(400, 'An agent needs a name and role instructions.');
  if (input.engine !== undefined && input.engine !== 'codex') throw new RunError(400, 'This release supports Codex Agent profiles only.');
  const name = input.name.trim(); const instructions = input.instructions.trim();
  if (!name || name.length > 40 || /[@\n\r]/u.test(name)) throw new RunError(400, 'Agent name must be 1–40 characters and cannot contain @ or newlines.');
  if (!instructions || instructions.length > 4_000) throw new RunError(400, 'Agent role instructions must be 1–4000 characters.');
  const model = input.model ?? DEFAULT_CODEX_MODEL;
  const effort = input.effort ?? DEFAULT_CODEX_EFFORT;
  if (!isCodexModel(model)) throw new RunError(400, 'Unsupported Codex model.');
  if (!isCodexEffort(effort)) throw new RunError(400, 'Unsupported Codex thinking effort.');
  const avatarId = input.avatarId === undefined ? 0 : input.avatarId;
  if (!Number.isInteger(avatarId) || avatarId < 0 || avatarId > 23) throw new RunError(400, 'avatarId must be an integer from 0 to 23.');
  if ((input.machineId === undefined) !== (input.directory === undefined)) throw new RunError(400, 'machineId and directory must be provided together.');
  if (input.machineId !== undefined && (typeof input.machineId !== 'string' || typeof input.directory !== 'string')) throw new RunError(400, 'machineId and directory must be strings.');
  const machineId = input.machineId?.trim(); const directory = input.directory?.trim();
  if (input.machineId !== undefined && (!machineId || !directory)) throw new RunError(400, 'machineId and directory must be provided together.');
  if (directory && !isAbsoluteDirectory(directory)) throw new RunError(400, 'Enter an absolute working directory already approved in Paws.');
  return { name, instructions, engine: 'codex', model, effort, avatarId, ...(machineId && directory ? { machineId, directory } : {}) };
}
const normalize = normalizeProfileInput;
function normalizeStoredProfile(profile: AgentProfile): AgentProfile {
  return {
    ...profile,
    engine: 'codex',
    model: isCodexModel(profile.model) ? profile.model : DEFAULT_CODEX_MODEL,
    effort: isCodexEffort(profile.effort) ? profile.effort : DEFAULT_CODEX_EFFORT,
    avatarId: Number.isInteger(profile.avatarId) && profile.avatarId >= 0 && profile.avatarId <= 23 ? profile.avatarId : 0,
  };
}
function sameProfile(left: AgentProfile, right: AgentProfile): boolean { return left.engine === right.engine && left.model === right.model && left.effort === right.effort && left.avatarId === right.avatarId; }
function clone<T>(value: T): T { return structuredClone(value); }
function isAbsoluteDirectory(value: string): boolean { return value.startsWith('/') && !value.includes('\0'); }

function boundedString(value: unknown, field: string, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new RunError(400, `Invalid ${field}`);
  return value.trim();
}
function normalizeMyAgent(input: Record<string, unknown>) {
  const base = normalizeProfileInput(input as unknown as AgentProfileInput);
  const skills = input.skills ?? [];
  if (!Array.isArray(skills) || skills.length > 16) throw new RunError(400, '最多绑定 16 个 Skills。');
  const normalized = skills.map(s => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new RunError(400, 'Invalid Skill');
    const name = boundedString(s.name, 'Skill name', 128, true);
    const reason = boundedString(s.reason, 'Skill reason', 500, true);
    const path = s.path === undefined ? undefined : boundedString(s.path, 'Skill path', 4096, true);
    if (path && !isAbsoluteDirectory(path)) throw new RunError(400, 'Skill path must be absolute');
    return { name, reason, ...(path ? { path } : {}) };
  });
  if (new Set(normalized.map(s => s.name)).size !== normalized.length) throw new RunError(400, 'Skills cannot be duplicated');
  return { ...base, summary: boundedString(input.summary ?? '', 'summary', 240), skills: normalized,
    preferences: boundedString(input.preferences ?? '', 'preferences', 4000), setupNotes: boundedString(input.setupNotes ?? '', 'setupNotes', 2000) };
}
