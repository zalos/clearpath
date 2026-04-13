/** @type {import('@wallabyjs/public-api').IWallabyConfig} */
module.exports = function () {
  return {
    // autoDetect reads vitest.config.ts (resolve.alias, environmentMatchGlobs,
    // coverage settings, etc.) so Wallaby runs under the same Vite pipeline
    // that resolves 'electron' → the test mock.
    autoDetect: true,

    // Explicit files list so Wallaby watches (and shows coverage for) ALL
    // source files — not just those imported by a test. Without this,
    // unimported files get null coverage and are excluded from the overall %.
    files: [
      'src/**/*.ts',
      'src/**/*.tsx',
      '!src/**/*.{test,spec}.{ts,tsx}',
      '!src/**/index.ts',
      '!src/**/index.tsx',
      '!src/main/index.ts',
      '!src/renderer/src/main.tsx',
      '!src/**/*.d.ts',
      '!src/**/types.ts',
      '!src/**/types/**',
      '!src/test/**',
      'vitest.config.ts',
    ],

    tests: ['src/**/*.{test,spec}.{ts,tsx}'],
  };
};
