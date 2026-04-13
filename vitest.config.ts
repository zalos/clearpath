import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      // Redirect all 'electron' imports to a lightweight mock so that
      // main-process and renderer files can be loaded (and coverage-
      // instrumented) in the Node.js/jsdom test environment used by
      // Vitest and Wallaby.
      electron: resolve(__dirname, 'src/test/electron-mock.ts'),
    },
  },
  plugins: [react()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/index.ts',
        'src/**/index.tsx',
        'src/main/index.ts',
        'src/renderer/src/main.tsx',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/types/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/test/**',
      ],
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/setup-coverage.ts'],
    // Use workspace-style environment selection via file-level comments
    // Default to node for main process tests
    environment: 'node',
    // Allow per-file environment override via @vitest-environment comment
    environmentMatchGlobs: [
      ['src/renderer/**/*.{test,spec}.{ts,tsx}', 'jsdom'],
    ],
    globals: true,
  },
})
