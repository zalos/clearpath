# BUG-029: prScoresHandlers Dynamic Import Bypasses Test Mocking

## Status
Open

## Component
`src/main/ipc/prScoresHandlers.ts` — `getPrScorePackage()` function

## Description
`prScoresHandlers.ts` loads the `pull-request-score` package using a `new Function('mod', 'return import(mod)')` trick to prevent Vite from static-analyzing the import. While this solves the bundling problem, it makes the package impossible to mock in Vitest because:

1. `vi.mock('pull-request-score', ...)` works by intercepting static `import` calls at module evaluation time via Vitest's module registry.
2. `new Function('mod', 'return import(mod)')` creates a JavaScript `import()` call at runtime from within an eval'd string. In the Node.js/Vitest test environment, this resolves to the real module system rather than Vitest's mock registry.
3. Attempting this dynamic import in the test environment throws: `"A dynamic import callback was not specified."` — a Node.js error meaning the runtime doesn't know how to handle the `import()` inside `new Function`.

As a result, any handler that calls `getPrScorePackage()` — including `score-pr`, `score-all`, `collect-prs`, `calculate-metrics`, `compute-deltas`, and `build-ai-context` — cannot be tested against mock implementations of the package functions.

## Steps to Reproduce
1. Add `vi.mock('pull-request-score', () => ({ collectPullRequests: vi.fn() }))` to the test file.
2. Call a handler that invokes `getPrScorePackage()` (e.g. `pr-scores:score-pr`).
3. Handler throws: `"A dynamic import callback was not specified."`

## Expected Behavior
Vitest should be able to mock `pull-request-score` so that handlers using it can be unit-tested with controlled inputs/outputs.

## Actual Behavior
The `new Function()` eval context bypasses Vitest's module interception. The dynamic `import()` fails with a Node.js runtime error.

## Suggested Fix
Replace the `new Function()` pattern with a direct `import()` call wrapped in the handler itself, or extract the `_dynamicImport` as a named export so tests can replace it:

```typescript
// Option A: export the dynamic import for test injection
export let _importPrScorePkg = (mod: string) => import(mod)

// Option B: use lazy initialization with an injectable factory
let _factory: (() => Promise<typeof import('pull-request-score')>) | null = null
export function setPrScorePackageFactory(f: typeof _factory) { _factory = f }
```

## Discovered By
`src/main/ipc/prScoresHandlers.test.ts` — multiple tests in `pr-scores:score-pr`, `pr-scores:score-all`, `pr-scores:collect-prs`, `pr-scores:calculate-metrics`, `pr-scores:compute-deltas`, `pr-scores:build-ai-context`
