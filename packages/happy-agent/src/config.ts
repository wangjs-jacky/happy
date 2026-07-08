import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = {
    serverUrl: string;
    homeDir: string;
    credentialPath: string;
};

export function loadConfig(): Config {
    // Same default as happy-cli: plain-HTTP 3005 (8443 is self-signed, Node rejects it)
    const serverUrl = (process.env.HAPPY_SERVER_URL ?? 'http://47.115.228.20:3005').replace(/\/+$/, '');
    const homeDir = process.env.HAPPY_HOME_DIR ?? join(homedir(), '.happy');
    const credentialPath = join(homeDir, 'agent.key');
    return { serverUrl, homeDir, credentialPath };
}
