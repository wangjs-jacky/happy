import fs from 'node:fs';
import path from 'node:path';
import { seedVercelPreviewFixture } from './fixture';

function argument(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const environmentRoot = path.join(repoRoot, 'environments', 'data');
    const requestedEnvironment = argument('--environment');
    const environmentName = requestedEnvironment ?? (
        JSON.parse(fs.readFileSync(path.join(environmentRoot, 'current.json'), 'utf8')) as { current: string }
    ).current;
    const config = JSON.parse(fs.readFileSync(path.join(environmentRoot, 'envs', environmentName, 'environment.json'), 'utf8')) as {
        authenticatedWebUrl?: string;
        serverPort: number;
    };
    if (!config.authenticatedWebUrl) throw new Error(`Environment ${environmentName} has not been seeded.`);

    const result = await seedVercelPreviewFixture({
        serverUrl: `http://localhost:${config.serverPort}`,
        webUrl: config.authenticatedWebUrl,
    });
    const settingsUrl = new URL(config.authenticatedWebUrl);
    settingsUrl.pathname = '/settings/temporary-previews';
    settingsUrl.searchParams.set('happy_preview_fixture', 'disconnected');

    process.stdout.write(`${JSON.stringify({
        environment: environmentName,
        sessionId: result.sessionId,
        sessionUrl: result.sessionUrl,
        settingsUrl: settingsUrl.toString(),
    }, null, 2)}\n`);
}

void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
});
