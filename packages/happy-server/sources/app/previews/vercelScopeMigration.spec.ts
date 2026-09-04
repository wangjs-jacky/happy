import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../standalone';

describe('Vercel scope provenance migration', () => {
    const temporaryDirectories: string[] = [];

    afterEach(async () => {
        await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
    });

    it('backfills legacy null-team provider rows as unknown while new rows default to known', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'happy-vercel-scope-migration-'));
        temporaryDirectories.push(directory);
        const migrationsDir = join(directory, 'migrations');
        const sourceDir = join(process.cwd(), 'prisma', 'migrations');
        const migrationName = '20260904150000_harden_vercel_connection_fences';
        await mkdir(migrationsDir);
        for (const entry of await readdir(sourceDir)) {
            if (entry < migrationName) await cp(join(sourceDir, entry), join(migrationsDir, entry), { recursive: true });
        }
        const databaseDir = join(directory, 'pglite');
        await runMigrations({ pgliteDir: databaseDir, migrationsDir });
        const database = new PGlite(databaseDir);
        await database.exec(`
            INSERT INTO "Account" ("id", "publicKey", "createdAt", "updatedAt") VALUES ('account-legacy', 'public-key-legacy', now(), now());
            INSERT INTO "InteractivePreview" ("id", "accountId", "title", "manifest", "stagingGeneration", "expiresAt", "vercelDeploymentId", "createdAt", "updatedAt")
            VALUES ('preview-legacy', 'account-legacy', 'Legacy', '{"version":1}'::jsonb, 'generation-1', now(), 'dpl_legacy', now(), now());
        `);
        await database.close();
        await cp(join(sourceDir, migrationName), join(migrationsDir, migrationName), { recursive: true });
        await runMigrations({ pgliteDir: databaseDir, migrationsDir });
        const migrated = new PGlite(databaseDir);
        const legacy = await migrated.query<{ vercelScopeKnown: boolean }>('SELECT "vercelScopeKnown" FROM "InteractivePreview" WHERE "id" = $1', ['preview-legacy']);
        await migrated.exec(`
            INSERT INTO "InteractivePreview" ("id", "accountId", "title", "manifest", "stagingGeneration", "expiresAt", "createdAt", "updatedAt")
            VALUES ('preview-new', 'account-legacy', 'New', '{"version":1}'::jsonb, 'generation-2', now(), now(), now());
        `);
        const fresh = await migrated.query<{ vercelScopeKnown: boolean }>('SELECT "vercelScopeKnown" FROM "InteractivePreview" WHERE "id" = $1', ['preview-new']);
        await migrated.close();

        expect(legacy.rows).toEqual([{ vercelScopeKnown: false }]);
        expect(fresh.rows).toEqual([{ vercelScopeKnown: true }]);
    }, 30_000);
});
