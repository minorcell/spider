import { defineConfig } from 'vitest/config';

const inferenceProxy = {
  '/inference': {
    target: 'https://opencode.ai',
    changeOrigin: true,
    headers: {
      'user-agent': 'spider/0.1',
      'x-opencode-session': 'spider-local-dev',
    },
  },
};

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: inferenceProxy,
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: inferenceProxy,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'worker/src/**/*.js'],
      // Type-only modules carry no runtime statements.
      exclude: ['src/shared/protocol.ts', 'src/shared/types.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
