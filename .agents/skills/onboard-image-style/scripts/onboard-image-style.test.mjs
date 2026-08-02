import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import sharp from 'sharp';
import { inspectReferences } from './inspect-references.mjs';
import { onboardStyle } from './onboard-image-style.mjs';

const PATHS = {
    catalog: 'packages/happy-app/sources/components/agents/imageStyleCatalogExtras.ts',
    manifest: 'packages/happy-app/sources/components/agents/imageStylePreviewManifestExtras.ts',
    assets: 'packages/happy-app/sources/components/agents/imageStylePreviewAssetsExtras.ts',
    manifestTest: 'packages/happy-app/sources/components/agents/imageStylePreviewManifest.test.ts',
};

const LONG_PROMPT = 'Transform the source into a cinematic editorial image while preserving the primary subject, recognizable identity, pose, clothing, and framing. Keep the focal subject sharp while the surrounding environment carries controlled motion, warm natural light, restrained film grain, realistic depth, and subtle highlight bloom. Avoid comparison labels, phone UI, logos, watermarks, duplicate people, distorted anatomy, random text, and unrelated scene details.';

async function writeFixtureFile(root, relativePath, content) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
}

async function createFixture({ existingTargetCategory = false } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'image-style-workflow-'));
    const category = existingTargetCategory
        ? `    {\n        "id": "reference-motion-street",\n        "label": "动态街拍案例",\n        "accent": "#A86C45",\n        "count": 2\n    }`
        : `    {\n        "id": "reference-existing",\n        "label": "已有案例",\n        "accent": "#112233",\n        "count": 1\n    }`;

    await writeFixtureFile(root, PATHS.catalog, `import type { ImageAgentStyleCategory, ImageAgentStylePreset } from './imageStyleTypes';\n\nexport const EXTRA_IMAGE_AGENT_STYLE_CATEGORIES: ImageAgentStyleCategory[] = [\n${category}\n];\n\nexport const EXTRA_IMAGE_AGENT_STYLE_PRESETS: ImageAgentStylePreset[] = [\n    {\n        "id": "reference-existing/base/1"\n    }\n];\n`);
    await writeFixtureFile(root, PATHS.manifest, `export const EXTRA_IMAGE_STYLE_PREVIEW_MANIFEST = {\n    "reference-existing/base/1": {\n        "fileName": "base.jpg"\n    }\n};\n`);
    await writeFixtureFile(root, PATHS.assets, `export const EXTRA_IMAGE_STYLE_PREVIEW_ASSETS = {\n    "reference-existing/base/1": require('@/assets/images/gpt-image-2/reference-examples/base.jpg'),\n};\n`);
    await writeFixtureFile(root, PATHS.manifestTest, `const IMAGE_STYLE_COUNT = 206;\nconst IMAGE_STYLE_CATEGORY_COUNT = 21;\nconst GARDEN_CASE_COUNT = 162;\nconst REFERENCE_CASE_COUNT = 44;\n`);

    const coverPath = join(root, 'generated-cover.png');
    await sharp({
        create: {
            width: 1200,
            height: 1600,
            channels: 3,
            background: '#A86C45',
        },
    }).png().toFile(coverPath);

    const specPath = join(root, 'style-spec.json');
    await writeFile(specPath, JSON.stringify({
        referenceSha256: ['0000000000000000000000000000000000000000000000000000000000000000'],
        category: {
            id: 'reference-motion-street',
            label: '动态街拍案例',
            accent: '#A86C45',
        },
        style: {
            id: 'reference-motion-street/cinematic-flow/1',
            title: '时光流影街拍',
            templateRef: 'reference-examples/motion-street-reference/cinematic-flow.md',
            templateLabel: 'Cinematic Street Flow',
            promptHint: '主体清晰、环境人流形成横向慢门拖影的暖调电影街拍效果。',
            promptContent: LONG_PROMPT,
            promptPath: 'garden-gpt-image-2/prompt/cinematic-street-flow.md',
            sourceCaseId: 'motion-street-reference/01-cinematic-flow',
        },
        preview: {
            source: coverPath,
            fileName: 'cinematic-street-flow.png',
            sourceIndex: 1,
        },
    }, null, 2));

    return { root, specPath, coverPath };
}

test('registers a new category and derives preview dimensions', async () => {
    const fixture = await createFixture();
    const result = await onboardStyle({ repoRoot: fixture.root, specPath: fixture.specPath });

    assert.equal(result.categoryCreated, true);
    assert.equal(result.preview.width, 480);
    assert.equal(result.preview.height, 640);
    assert.ok(result.preview.bytes <= 512 * 1024);

    const catalog = await readFile(join(fixture.root, PATHS.catalog), 'utf8');
    const manifest = await readFile(join(fixture.root, PATHS.manifest), 'utf8');
    const assets = await readFile(join(fixture.root, PATHS.assets), 'utf8');
    const manifestTest = await readFile(join(fixture.root, PATHS.manifestTest), 'utf8');
    const copiedPreview = await readFile(join(fixture.root, 'packages/happy-app/sources/assets/images/gpt-image-2/reference-examples/cinematic-street-flow.png'));

    assert.match(catalog, /"id": "reference-motion-street"/);
    assert.match(catalog, /"id": "reference-motion-street\/cinematic-flow\/1"/);
    assert.match(manifest, /"width": 480/);
    assert.match(manifest, /"height": 640/);
    assert.match(assets, /cinematic-street-flow\.png/);
    assert.match(manifestTest, /IMAGE_STYLE_COUNT = 207/);
    assert.match(manifestTest, /IMAGE_STYLE_CATEGORY_COUNT = 22/);
    assert.match(manifestTest, /REFERENCE_CASE_COUNT = 45/);
    assert.notDeepEqual(copiedPreview, await readFile(fixture.coverPath));
    assert.deepEqual(await sharp(copiedPreview).metadata().then(({ width, height }) => ({ width, height })), { width: 480, height: 640 });
});

test('increments an existing category without changing the category total', async () => {
    const fixture = await createFixture({ existingTargetCategory: true });
    const result = await onboardStyle({ repoRoot: fixture.root, specPath: fixture.specPath });

    assert.equal(result.categoryCreated, false);
    const catalog = await readFile(join(fixture.root, PATHS.catalog), 'utf8');
    const manifestTest = await readFile(join(fixture.root, PATHS.manifestTest), 'utf8');
    assert.match(catalog, /"count": 3/);
    assert.match(manifestTest, /IMAGE_STYLE_CATEGORY_COUNT = 21/);
});

test('dry-run validates but leaves every registry unchanged', async () => {
    const fixture = await createFixture();
    const before = await readFile(join(fixture.root, PATHS.catalog), 'utf8');
    const result = await onboardStyle({ repoRoot: fixture.root, specPath: fixture.specPath, dryRun: true });
    const after = await readFile(join(fixture.root, PATHS.catalog), 'utf8');

    assert.equal(result.dryRun, true);
    assert.equal(after, before);
});

test('rejects a user attachment as the gallery preview', async () => {
    const fixture = await createFixture();
    const attachmentPath = join(fixture.root, '.happy', 'attachments', 'reference.png');
    await mkdir(dirname(attachmentPath), { recursive: true });
    await writeFile(attachmentPath, await readFile(fixture.coverPath));
    const spec = JSON.parse(await readFile(fixture.specPath, 'utf8'));
    spec.preview.source = attachmentPath;
    await writeFile(fixture.specPath, JSON.stringify(spec));

    await assert.rejects(
        onboardStyle({ repoRoot: fixture.root, specPath: fixture.specPath }),
        /cannot be a user attachment/,
    );
});

test('rejects duplicate styles and unsupported spec fields', async () => {
    const fixture = await createFixture();
    await onboardStyle({ repoRoot: fixture.root, specPath: fixture.specPath });
    await assert.rejects(
        onboardStyle({ repoRoot: fixture.root, specPath: fixture.specPath }),
        /already exists in the catalog/,
    );

    const nextFixture = await createFixture();
    const spec = JSON.parse(await readFile(nextFixture.specPath, 'utf8'));
    spec.style.sourceRepository = 'user-reference';
    await writeFile(nextFixture.specPath, JSON.stringify(spec));
    await assert.rejects(
        onboardStyle({ repoRoot: nextFixture.root, specPath: nextFixture.specPath }),
        /unsupported fields: sourceRepository/,
    );
});

test('rejects a renamed copy of an inspected reference', async () => {
    const fixture = await createFixture();
    const spec = JSON.parse(await readFile(fixture.specPath, 'utf8'));
    spec.referenceSha256 = [createHash('sha256').update(await readFile(fixture.coverPath)).digest('hex')];
    await writeFile(fixture.specPath, JSON.stringify(spec));

    await assert.rejects(
        onboardStyle({ repoRoot: fixture.root, specPath: fixture.specPath }),
        /same content as a reference image/,
    );
});

test('inspects only explicit paths and reports exact duplicates', async () => {
    const fixture = await createFixture();
    const copyPath = join(fixture.root, 'copy.png');
    await writeFile(copyPath, await readFile(fixture.coverPath));
    const result = await inspectReferences([fixture.coverPath, copyPath]);

    assert.equal(result.files.length, 2);
    assert.equal(result.duplicateGroups.length, 1);
    assert.deepEqual(result.duplicateGroups[0].paths, [fixture.coverPath, copyPath]);
});

test('reports visually equivalent images encoded with different bytes', async () => {
    const fixture = await createFixture();
    const recompressedPath = join(fixture.root, 'recompressed.png');
    await sharp(fixture.coverPath).png({ compressionLevel: 0 }).toFile(recompressedPath);
    const result = await inspectReferences([fixture.coverPath, recompressedPath]);

    assert.equal(result.duplicateGroups.length, 0);
    assert.equal(result.nearDuplicateGroups.length, 1);
    assert.deepEqual(result.nearDuplicateGroups[0].paths, [fixture.coverPath, recompressedPath]);
});

test('CLI entrypoints accept pnpm-style argument separators', async () => {
    const fixture = await createFixture();
    const scriptDir = dirname(new URL(import.meta.url).pathname);
    const inspectRun = spawnSync(process.execPath, [join(scriptDir, 'inspect-references.mjs'), '--', fixture.coverPath], { encoding: 'utf8' });
    const onboardRun = spawnSync(process.execPath, [join(scriptDir, 'onboard-image-style.mjs'), '--', '--repo-root', fixture.root, '--spec', fixture.specPath, '--dry-run'], { encoding: 'utf8' });

    assert.equal(inspectRun.status, 0, inspectRun.stderr);
    assert.equal(onboardRun.status, 0, onboardRun.stderr);
    assert.equal(JSON.parse(inspectRun.stdout).files.length, 1);
    assert.equal(JSON.parse(onboardRun.stdout).dryRun, true);
});
