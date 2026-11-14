import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({ test: { environment: 'node', include: ['src/personal/computer/*.test.ts'], fileParallelism: false }, resolve: { alias: { '@': resolve(process.cwd(), 'src') } } });
