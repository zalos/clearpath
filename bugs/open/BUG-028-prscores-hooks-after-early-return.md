# BUG-028: PrScores component calls hooks after conditional early return

## Severity
**High** — Component crashes on render when feature flags load asynchronously

## Description
`PrScores.tsx` has a feature-gate early return at line 93 that fires before `useCallback` hooks are declared on lines 111 and 118. Since `FeatureFlagContext` defaults have `enableExperimentalFeatures: false` and `showPrScores: false`, the initial render hits the early return and skips hooks. When the async `load()` in `FeatureFlagProvider` resolves and updates flags to enabled, the re-render attempts to call the previously-skipped hooks, violating React's Rules of Hooks.

## Steps to Reproduce
1. Render `<FeatureFlagProvider><PrScores /></FeatureFlagProvider>`
2. Mock `feature-flags:get` to return flags with `enableExperimentalFeatures: true` and `showPrScores: true`
3. Observe: first render returns early (default flags off), second render tries to call more hooks

## Error
```
Error: Rendered more hooks than during the previous render.
  at updateWorkInProgressHook (react-dom.development.js:15688)
  at PrScores (PrScores.tsx:111)
```

## Root Cause
Lines 93-107 in `PrScores.tsx` return JSX before hooks on lines 111+ are called. React requires the same hooks to be called in the same order on every render.

## Fix
Move all hooks (`useCallback`, `useEffect`) above the early return, or restructure the component to avoid conditional hook calls (e.g., render the disabled state as a child component, or use the flag to conditionally render content inside the return, not before hooks).

## Files
- `src/renderer/src/pages/PrScores.tsx:93-118`

## Tests Affected
- `src/renderer/src/pages/PrScores.test.tsx` — 38 tests fail with uncaught exception
