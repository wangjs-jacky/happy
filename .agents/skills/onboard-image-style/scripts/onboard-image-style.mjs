#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const SOURCE_SET = 'curated-reference-examples';
const MAX_PREVIEW_EDGE = 640;
const MAX_PREVIEW_BYTES = 512 * 1024;
const PATHS = {
    catalog: 'packages/happy-app/sources/components/agents/imageStyleCatalogExtras.ts',
    manifest: 'packages/happy-app/sources/components/agents/imageStylePreviewManifestExtras.ts',
    assets: 'packages/happy-app/sources/components/agents/imageStylePreviewAssetsExtras.ts',
    manifestTest: 'packages/happy-app/sources/components/agents/imageStylePreviewManifest.test.ts',
    previewDir: 'packages/happy-app/sources/assets/images/gpt-image-2/reference-examples',
};

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function assertOnlyKeys(value, allowedKeys, label) {
    const unexpected = Object.keys(value).filter((key) => !allowedKeys.includes(key));
    assert(unexpected.length === 0, `${label} contains unsupported fields: ${unexpected.join(', ')}.`);
}

function validateSpec(spec) {
    assert(spec && typeof spec === 'object' && !Array.isArray(spec), 'Spec must be a JSON object.');
    assert(spec.category && typeof spec.category === 'object', 'Missing category object.');
    assert(spec.style && typeof spec.style === 'object', 'Missing style object.');
    assert(spec.preview && typeof spec.preview === 'object', 'Missing preview object.');

    const { category, style, preview } = spec;
    assertOnlyKeys(spec, ['category', 'style', 'preview', 'referenceSha256'], 'Spec');
    assertOnlyKeys(category, ['id', 'label', 'accent'], 'category');
    assertOnlyKeys(style, ['id', 'title', 'templateRef', 'templateLabel', 'promptHint', 'promptContent', 'promptPath', 'sourceCaseId'], 'style');
    assertOnlyKeys(preview, ['source', 'fileName', 'sourceIndex'], 'preview');
    assert(Array.isArray(spec.referenceSha256) && spec.referenceSha256.length > 0, 'referenceSha256 must list the inspected reference hashes.');
    assert(spec.referenceSha256.every((hash) => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)), 'referenceSha256 values must be lowercase SHA-256 hashes.');
    assert(/^reference-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category.id ?? ''), 'category.id must start with reference- and use lowercase kebab-case.');
    assert(isNonEmptyString(category.label), 'category.label is required.');
    assert(/^#[0-9A-Fa-f]{6}$/.test(category.accent ?? ''), 'category.accent must be a six-digit hex color.');
    assert(new RegExp(`^${category.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-z0-9]+(?:-[a-z0-9]+)*/[1-9][0-9]*$`).test(style.id ?? ''), 'style.id must use the category ID, kebab-case style path, and a positive numeric variant.');
    assert(isNonEmptyString(style.title), 'style.title is required.');
    assert(isNonEmptyString(style.templateLabel), 'style.templateLabel is required.');
    assert(isNonEmptyString(style.templateRef) && style.templateRef.endsWith('.md'), 'style.templateRef must end in .md.');
    assert(isNonEmptyString(style.promptHint) && style.promptHint.length >= 20, 'style.promptHint must be at least 20 characters.');
    assert(isNonEmptyString(style.promptContent) && style.promptContent.length > 200, 'style.promptContent must be longer than 200 characters.');
    assert(isNonEmptyString(style.promptPath) && style.promptPath.endsWith('.md'), 'style.promptPath must end in .md.');
    assert(isNonEmptyString(style.sourceCaseId), 'style.sourceCaseId is required.');
    assert(isNonEmptyString(preview.source), 'preview.source is required.');
    assert(isNonEmptyString(preview.fileName) && basename(preview.fileName) === preview.fileName, 'preview.fileName must be a basename.');
    assert(/^[-a-z0-9]+\.(?:jpg|png)$/.test(preview.fileName), 'preview.fileName must be lowercase kebab-case with a .jpg or .png extension.');
    assert(preview.sourceIndex === undefined || Number.isInteger(preview.sourceIndex) && preview.sourceIndex > 0, 'preview.sourceIndex must be a positive integer.');
}

async function normalizePreview(previewBuffer, format) {
    let pipeline = sharp(previewBuffer)
        .rotate()
        .resize({
            width: MAX_PREVIEW_EDGE,
            height: MAX_PREVIEW_EDGE,
            fit: 'inside',
            withoutEnlargement: true,
        });
    pipeline = format === 'jpeg'
        ? pipeline.jpeg({ quality: 82, progressive: true, mozjpeg: true })
        : pipeline.png({ compressionLevel: 9, palette: true, quality: 90 });
    const normalized = await pipeline.toBuffer({ resolveWithObject: true });
    assert(normalized.info.width > 0 && normalized.info.height > 0, 'Unable to determine normalized preview dimensions.');
    assert(normalized.data.byteLength <= MAX_PREVIEW_BYTES, `Normalized preview is ${normalized.data.byteLength} bytes; maximum is ${MAX_PREVIEW_BYTES}. Use a JPEG cover or simplify the image.`);
    return normalized;
}

function indentJson(value, spaces) {
    const prefix = ' '.repeat(spaces);
    return JSON.stringify(value, null, 4).split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function appendArrayItem(source, exportName, item) {
    const marker = `export const ${exportName}`;
    const start = source.indexOf(marker);
    assert(start >= 0, `Unable to find ${exportName}.`);
    const end = source.indexOf('\n];', start);
    assert(end >= 0, `Unable to find the end of ${exportName}.`);
    return `${source.slice(0, end)},\n${indentJson(item, 4)}${source.slice(end)}`;
}

function updateExistingCategory(source, category) {
    const idMarker = `"id": ${JSON.stringify(category.id)}`;
    const idPosition = source.indexOf(idMarker);
    if (idPosition < 0) return null;

    const objectStart = source.lastIndexOf('    {', idPosition);
    const objectEnd = source.indexOf('\n    }', idPosition);
    assert(objectStart >= 0 && objectEnd >= 0, `Unable to parse category ${category.id}.`);
    const existing = JSON.parse(source.slice(objectStart + 4, objectEnd + 6));
    assert(existing.label === category.label, `Category ${category.id} already uses label ${existing.label}.`);
    assert(existing.accent.toLowerCase() === category.accent.toLowerCase(), `Category ${category.id} already uses accent ${existing.accent}.`);
    existing.count += 1;
    return `${source.slice(0, objectStart)}${indentJson(existing, 4)}${source.slice(objectEnd + 6)}`;
}

function appendObjectProperty(source, exportName, key, value) {
    const marker = `export const ${exportName}`;
    const start = source.indexOf(marker);
    assert(start >= 0, `Unable to find ${exportName}.`);
    const end = source.indexOf('\n};', start);
    assert(end >= 0, `Unable to find the end of ${exportName}.`);
    const jsonLines = JSON.stringify(value, null, 4).split('\n');
    const property = [
        `    ${JSON.stringify(key)}: ${jsonLines[0]}`,
        ...jsonLines.slice(1).map((line) => `    ${line}`),
    ].join('\n');
    return `${source.slice(0, end)},\n${property}${source.slice(end)}`;
}

function appendAssetProperty(source, styleId, fileName) {
    const marker = 'export const EXTRA_IMAGE_STYLE_PREVIEW_ASSETS';
    const start = source.indexOf(marker);
    assert(start >= 0, 'Unable to find EXTRA_IMAGE_STYLE_PREVIEW_ASSETS.');
    const end = source.indexOf('\n};', start);
    assert(end >= 0, 'Unable to find the end of EXTRA_IMAGE_STYLE_PREVIEW_ASSETS.');
    const line = `    ${JSON.stringify(styleId)}: require('@/assets/images/gpt-image-2/reference-examples/${fileName}'),`;
    return `${source.slice(0, end)}\n${line}${source.slice(end)}`;
}

function incrementConstant(source, name, delta = 1) {
    const pattern = new RegExp(`const ${name} = (\\d+);`);
    const match = source.match(pattern);
    assert(match, `Unable to find ${name}.`);
    return source.replace(pattern, `const ${name} = ${Number(match[1]) + delta};`);
}

async function atomicWrite(outputs) {
    const originals = new Map();
    const tempPaths = [];

    try {
        for (const [path, content] of outputs) {
            await mkdir(dirname(path), { recursive: true });
            try {
                originals.set(path, await readFile(path));
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error;
                originals.set(path, null);
            }
            const tempPath = `${path}.onboard-${process.pid}.tmp`;
            await writeFile(tempPath, content);
            tempPaths.push(tempPath);
        }

        for (let index = 0; index < outputs.length; index += 1) {
            await rename(tempPaths[index], outputs[index][0]);
        }
    } catch (error) {
        for (const tempPath of tempPaths) {
            await unlink(tempPath).catch(() => {});
        }
        for (const [path, original] of originals) {
            if (original === null) await unlink(path).catch(() => {});
            else await writeFile(path, original);
        }
        throw error;
    }
}

export async function onboardStyle({ repoRoot, specPath, dryRun = false }) {
    const absoluteRepoRoot = resolve(repoRoot);
    const absoluteSpecPath = resolve(specPath);
    const spec = JSON.parse(await readFile(absoluteSpecPath, 'utf8'));
    validateSpec(spec);

    const previewSource = await realpath(resolve(dirname(absoluteSpecPath), spec.preview.source));
    const attachmentSegment = `${sep}.happy${sep}attachments${sep}`;
    assert(!previewSource.includes(attachmentSegment), 'preview.source cannot be a user attachment. Generate an original cover first.');
    const sourcePreviewBuffer = await readFile(previewSource);
    const sourceHash = createHash('sha256').update(sourcePreviewBuffer).digest('hex');
    assert(!spec.referenceSha256.includes(sourceHash), 'preview.source has the same content as a reference image. Generate an original cover first.');
    const metadata = await sharp(sourcePreviewBuffer).metadata();
    assert(metadata.width && metadata.height && ['jpeg', 'png'].includes(metadata.format ?? ''), 'preview.source must be a readable JPEG or PNG.');
    const expectedFormat = extname(spec.preview.fileName) === '.jpg' ? 'jpeg' : 'png';
    assert(metadata.format === expectedFormat, `preview.fileName extension does not match the ${metadata.format} source image.`);
    const normalizedPreview = await normalizePreview(sourcePreviewBuffer, metadata.format);
    const previewBuffer = normalizedPreview.data;

    const files = Object.fromEntries(await Promise.all(
        Object.entries(PATHS)
            .filter(([key]) => key !== 'previewDir')
            .map(async ([key, relativePath]) => [key, await readFile(resolve(absoluteRepoRoot, relativePath), 'utf8')]),
    ));

    const styleIdMarker = JSON.stringify(spec.style.id);
    assert(!files.catalog.includes(`"id": ${styleIdMarker}`), `Style ${spec.style.id} already exists in the catalog.`);
    assert(!files.manifest.includes(`${styleIdMarker}:`), `Style ${spec.style.id} already exists in the manifest.`);
    assert(!files.assets.includes(`${styleIdMarker}:`), `Style ${spec.style.id} already exists in the asset registry.`);
    assert(!files.manifest.includes(`"sourceCaseId": ${JSON.stringify(spec.style.sourceCaseId)}`), `Source case ${spec.style.sourceCaseId} already exists in the manifest.`);

    const existingCategory = updateExistingCategory(files.catalog, spec.category);
    let catalog = existingCategory ?? appendArrayItem(files.catalog, 'EXTRA_IMAGE_AGENT_STYLE_CATEGORIES', {
        ...spec.category,
        count: 1,
    });
    catalog = appendArrayItem(catalog, 'EXTRA_IMAGE_AGENT_STYLE_PRESETS', {
        ...spec.style,
        categoryId: spec.category.id,
        categoryLabel: spec.category.label,
        categoryAccent: spec.category.accent,
        sourceRepository: SOURCE_SET,
    });

    const manifestEntry = {
        fileName: spec.preview.fileName,
        sourceSet: SOURCE_SET,
        sourceCaseId: spec.style.sourceCaseId,
        sourceIndex: spec.preview.sourceIndex ?? 1,
        width: normalizedPreview.info.width,
        height: normalizedPreview.info.height,
    };
    const manifest = appendObjectProperty(files.manifest, 'EXTRA_IMAGE_STYLE_PREVIEW_MANIFEST', spec.style.id, manifestEntry);
    const assets = appendAssetProperty(files.assets, spec.style.id, spec.preview.fileName);
    let manifestTest = incrementConstant(files.manifestTest, 'IMAGE_STYLE_COUNT');
    manifestTest = incrementConstant(manifestTest, 'REFERENCE_CASE_COUNT');
    if (!existingCategory) manifestTest = incrementConstant(manifestTest, 'IMAGE_STYLE_CATEGORY_COUNT');

    const previewTarget = resolve(absoluteRepoRoot, PATHS.previewDir, spec.preview.fileName);
    try {
        await readFile(previewTarget);
        throw new Error(`Preview asset already exists: ${previewTarget}`);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }

    const outputs = [
        [resolve(absoluteRepoRoot, PATHS.catalog), catalog],
        [resolve(absoluteRepoRoot, PATHS.manifest), manifest],
        [resolve(absoluteRepoRoot, PATHS.assets), assets],
        [resolve(absoluteRepoRoot, PATHS.manifestTest), manifestTest],
        [previewTarget, previewBuffer],
    ];

    const result = {
        dryRun,
        styleId: spec.style.id,
        categoryId: spec.category.id,
        categoryCreated: !existingCategory,
        preview: {
            path: previewTarget,
            width: normalizedPreview.info.width,
            height: normalizedPreview.info.height,
            format: metadata.format,
            bytes: previewBuffer.byteLength,
        },
        files: outputs.map(([path]) => path),
    };

    if (!dryRun) await atomicWrite(outputs);
    return result;
}

function parseArgs(args) {
    const options = { repoRoot: process.cwd(), dryRun: false };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--') continue;
        if (arg === '--dry-run') options.dryRun = true;
        else if (arg === '--spec') options.specPath = args[++index];
        else if (arg === '--repo-root') options.repoRoot = args[++index];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    assert(options.specPath, 'Usage: pnpm style:onboard -- --spec /absolute/spec.json [--dry-run] [--repo-root /repo]');
    return options;
}

async function main() {
    const result = await onboardStyle(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
