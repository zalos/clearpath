/**
 * Coverage setup for Vitest and Wallaby.
 *
 * Wallaby's instrumentation engine only instruments files that are actually
 * imported during a test run. Files that no test imports get `null` coverage
 * and are excluded from the overall percentage — making coverage appear much
 * higher than it really is.
 *
 * This setup file force-loads every source file via import.meta.glob so that
 * Wallaby (and Vitest's V8 provider) can see them all. Individual load failures
 * are silently swallowed so a broken file never fails the whole test suite.
 */

const modules = import.meta.glob<Record<string, unknown>>(
  [
    '../main/**/*.ts',
    '../renderer/src/**/*.{ts,tsx}',
    '../preload/**/*.ts',
    '!../**/*.{test,spec}.{ts,tsx}',
    '!../**/index.ts',
    '!../**/index.tsx',
    '!../**/*.d.ts',
    '!../**/types.ts',
    '!../**/types/**',
    '!../test/**',
  ],
  { eager: false }
)

// Load every matched file, silently ignoring failures so a single broken
// import (e.g. a file with unexpected side-effects) never fails unrelated tests.
await Promise.allSettled(Object.values(modules).map((load) => load()))
