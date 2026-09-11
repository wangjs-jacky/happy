/** Applied as native CLI overrides and again at every account thread boundary. */
export const CODEX_ACCOUNT_CONFIG = {
  model_provider: 'openai',
  forced_login_method: 'chatgpt',
  cli_auth_credentials_store: 'file',
  chatgpt_base_url: 'https://chatgpt.com/backend-api',
} as const;

export const CODEX_ACCOUNT_UNSET_ENV = [
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
  'CODEX_CHATGPT_BASE_URL', 'CHATGPT_BASE_URL', 'HAPPY_CODEX_APP_SERVER_SOCKET',
] as const;

export const CODEX_ACCOUNT_CONFIG_ERROR = 'Codex account configuration is incompatible. Remove custom OpenAI provider overrides and check the account in Settings → Device Environment.';

export function assertCodexAccountConfig(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error(CODEX_ACCOUNT_CONFIG_ERROR);
  const config = value as Record<string, unknown>;
  for (const [key, expected] of Object.entries(CODEX_ACCOUNT_CONFIG)) {
    if (config[key] !== expected) throw new Error(CODEX_ACCOUNT_CONFIG_ERROR);
  }
  // An inherited definition named "openai" can replace the native provider's
  // endpoint, headers or auth. Other definitions are inert with the pinned ID.
  const providers = config.model_providers;
  if (providers != null && (typeof providers !== 'object' || Array.isArray(providers)
      || Object.hasOwn(providers, 'openai'))) throw new Error(CODEX_ACCOUNT_CONFIG_ERROR);
}
