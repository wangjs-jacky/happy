import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@slopus/happy-wire': resolve('../happy-wire/dist/index.mjs'),
      'react-native-mmkv': resolve('../happy-app/sources/test/reactNativeMmkvMock.ts'),
    },
  },
  plugins: [tsconfigPaths()]
});
