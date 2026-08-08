import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const srcAlias = path.resolve(import.meta.dirname, './src');
const testAliases = { '@': srcAlias };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: testAliases,
  },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: testAliases },
        test: {
          name: 'unit',
          environment: 'node',
          globals: false,
          setupFiles: ['./src/test/helpers/unit-setup.ts'],
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/test/integration/**', 'node_modules/**'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: testAliases },
        test: {
          name: 'integration',
          environment: 'node',
          globals: false,
          setupFiles: ['./src/test/helpers/integration-setup.ts'],
          include: ['src/test/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
