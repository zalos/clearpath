# BUG-005: ClaudeCodeAdapter.test.ts — `afterEach` assigned instead of called

**Discovered:** April 9, 2026  
**File:** `src/main/cli/ClaudeCodeAdapter.test.ts`  
**Severity:** Medium (test-only, no production impact)

## Description

In the `isAuthenticated` describe block, `afterEach` is **assigned** (`afterEach = () => { ... }`) instead of **called** (`afterEach(() => { ... })`). This means the cleanup logic that restores `process.env.ANTHROPIC_API_KEY` never runs, causing test pollution across tests in that suite.

## Location

```ts
// Line ~888 in ClaudeCodeAdapter.test.ts
afterEach = () => {                         // BUG: assignment, not invocation
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey
  else delete process.env.ANTHROPIC_API_KEY
}
```

## Expected

```ts
afterEach(() => {
  if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey
  else delete process.env.ANTHROPIC_API_KEY
})
```

## Impact

- `ANTHROPIC_API_KEY` environment variable leaks between tests in the isAuthenticated suite
- May cause false positives/negatives in subsequent tests that check for the env var
