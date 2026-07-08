/**
 * Claude-specific process environment builder.
 *
 * Mirrors the Codex-side proxy isolation (buildCodexProcessEnv in
 * codex/codexAppServerClient.ts): the daemon itself stays proxy-neutral and
 * each agent opts into its own network settings via dedicated variables, so
 * one agent's gateway never leaks into another agent's subprocess.
 *
 * When HAPPY_CLAUDE_PROXY_URL (or CLAUDE_PROXY_URL) is set, the spawned
 * Claude process gets HTTP(S)_PROXY/ALL_PROXY (upper and lower case)
 * overridden to it. HAPPY_CLAUDE_EXTRA_CA_CERTS (or CLAUDE_EXTRA_CA_CERTS)
 * maps to NODE_EXTRA_CA_CERTS, for gateways fronted by a self-signed
 * certificate. When neither is set, the environment passes through
 * unchanged, so operators who don't need this see no behavior change.
 */
export function buildClaudeProcessEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'string') env[key] = value
    }

    const claudeProxy = env.HAPPY_CLAUDE_PROXY_URL || env.CLAUDE_PROXY_URL
    if (claudeProxy) {
        env.HTTP_PROXY = claudeProxy
        env.HTTPS_PROXY = claudeProxy
        env.ALL_PROXY = claudeProxy
        env.http_proxy = claudeProxy
        env.https_proxy = claudeProxy
        env.all_proxy = claudeProxy
    }

    const claudeCaCerts = env.HAPPY_CLAUDE_EXTRA_CA_CERTS || env.CLAUDE_EXTRA_CA_CERTS
    if (claudeCaCerts) {
        env.NODE_EXTRA_CA_CERTS = claudeCaCerts
    }

    return env
}
