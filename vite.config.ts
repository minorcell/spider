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
    minify: 'oxc',
    cssMinify: true,
    // three is one tightly coupled graph; keep the warning above its size.
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
            { name: 'ai', test: /node_modules[\\/](ai|@ai-sdk|zod)[\\/]/, priority: 15 },
          ],
        },
      },
    },
  },
  server: {
    port: 3300,
    strictPort: true,
    proxy: inferenceProxy,
  },
  preview: {
    port: 3300,
    strictPort: true,
    proxy: inferenceProxy,
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'src/ui/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'worker/src/**/*.js'],
      // Type-only modules carry no runtime statements. The worker entry is the
      // one-line binding to a real Worker global; its handler and transport are tested.
      exclude: [
        'src/client/worker/journal.worker.ts',
        'src/client/worker/protocol.ts',
        'src/ui/**/*.test.ts',
      ],
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
