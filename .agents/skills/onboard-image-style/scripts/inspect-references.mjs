#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

async function createDifferenceHash(data) {
    const pixels = await sharp(data)
        .greyscale()
        .resize(9, 8, { fit: 'fill' })
        .raw()
        .toBuffer();
    let bits = 0n;
    for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 8; column += 1) {
            bits = (bits << 1n) | BigInt(pixels[row * 9 + column] > pixels[row * 9 + column + 1]);
        }
    }
    return bits.toString(16).padStart(16, '0');
}

function hammingDistance(left, right) {
    let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
    let distance = 0;
    while (value > 0n) {
        distance += Number(value & 1n);
        value >>= 1n;
    }
    return distance;
}

export async function inspectReferences(paths) {
    if (!Array.isArray(paths) || paths.length === 0) {
        throw new Error('Pass one or more explicit image paths. Directory scanning is not supported.');
    }

    const files = await Promise.all(paths.map(async (inputPath) => {
        const path = resolve(inputPath);
        const data = await readFile(path);
        const metadata = await sharp(data).metadata();

        if (!metadata.width || !metadata.height || !['jpeg', 'png'].includes(metadata.format ?? '')) {
            throw new Error(`Unsupported image: ${path}. Expected a readable JPEG or PNG.`);
        }

        return {
            path,
            bytes: data.byteLength,
            sha256: createHash('sha256').update(data).digest('hex'),
            differenceHash: await createDifferenceHash(data),
            format: metadata.format,
            width: metadata.width,
            height: metadata.height,
        };
    }));

    const byHash = new Map();
    for (const file of files) {
        const matches = byHash.get(file.sha256) ?? [];
        matches.push(file.path);
        byHash.set(file.sha256, matches);
    }

    const duplicateGroups = [...byHash.entries()]
        .filter(([, duplicatePaths]) => duplicatePaths.length > 1)
        .map(([sha256, duplicatePaths]) => ({ sha256, paths: duplicatePaths }));

    const parents = files.map((_, index) => index);
    const find = (index) => {
        while (parents[index] !== index) {
            parents[index] = parents[parents[index]];
            index = parents[index];
        }
        return index;
    };
    const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };
    const distances = new Map();
    for (let left = 0; left < files.length; left += 1) {
        for (let right = left + 1; right < files.length; right += 1) {
            const distance = hammingDistance(files[left].differenceHash, files[right].differenceHash);
            distances.set(`${left}:${right}`, distance);
            if (distance <= 6) union(left, right);
        }
    }
    const clusters = new Map();
    for (let index = 0; index < files.length; index += 1) {
        const root = find(index);
        const indices = clusters.get(root) ?? [];
        indices.push(index);
        clusters.set(root, indices);
    }
    const nearDuplicateGroups = [...clusters.values()]
        .filter((indices) => indices.length > 1 && new Set(indices.map((index) => files[index].sha256)).size > 1)
        .map((indices) => {
            let maxHammingDistance = 0;
            for (let left = 0; left < indices.length; left += 1) {
                for (let right = left + 1; right < indices.length; right += 1) {
                    const first = Math.min(indices[left], indices[right]);
                    const second = Math.max(indices[left], indices[right]);
                    maxHammingDistance = Math.max(maxHammingDistance, distances.get(`${first}:${second}`) ?? 0);
                }
            }
            return { maxHammingDistance, paths: indices.map((index) => files[index].path) };
        });

    return { files, duplicateGroups, nearDuplicateGroups };
}

async function main() {
    const result = await inspectReferences(process.argv.slice(2).filter((arg) => arg !== '--'));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
