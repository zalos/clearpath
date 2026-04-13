# BUG-018: handlers.ts — New electron-store instance created on every session start

**Discovered:** April 10, 2026  
**File:** `src/main/ipc/handlers.ts`  
**Severity:** Low

## Description

In the `cli:start-session` handler (line 31), a new `Store({ name: 'clear-path-settings' })` is instantiated on every call to read the saved model setting. `electron-store` reads and parses the entire JSON file from disk on construction, so this creates unnecessary I/O and GC pressure on every session start.

```typescript
// Line 31 — inside the handler callback, runs on every invocation:
const settingsStore = new Store({ name: 'clear-path-settings', encryptionKey: getStoreEncryptionKey() })
```

## Expected Behavior

The settings store should be created once (at module level or during `registerIpcHandlers`) and reused across calls, consistent with how `templateHandlers.ts` and `skillHandlers.ts` create their stores at module level.

## Impact

- Extra disk I/O and JSON parsing on every session start
- Minor memory churn from short-lived Store instances
- Not a correctness issue — the behavior is functionally correct
- The same anti-pattern exists in `skillHandlers.ts` line 155 (`listAllSkills` creates `new Store({ name: 'clear-path-team' })` on every call)
