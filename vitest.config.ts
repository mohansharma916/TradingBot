import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
  resolve: {
    alias: {
      '@trading-bot/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@trading-bot/domain': path.resolve(__dirname, 'packages/domain/src/index.ts'),
      '@trading-bot/ui': path.resolve(__dirname, 'packages/ui/src/index.ts'),
      '@trading-bot/client-sdk': path.resolve(__dirname, 'packages/client-sdk/src/index.ts'),
    },
  },
});
