# BUG-001: storeEncryption.test.ts — 4 failing tests due to vi.mock hoisting + module caching

**File:** `src/main/utils/storeEncryption.test.ts`  
**Severity:** Medium — tests fail, actual runtime behavior is unaffected  
**Discovered:** April 2026, unit test coverage initiative  

## Symptom

```
FAIL  storeEncryption > checkEncryptionKeyIntegrity > reports changed when stored fingerprint differs
  Expected: { changed: true, isFirstRun: false }
  Received: { changed: false, isFirstRun: false }

FAIL  storeEncryption > checkEncryptionKeyIntegrity > always attempts to create the key directory
  expect(mkdirSyncMock).toHaveBeenCalledWith(…)  — Number of calls: 0

FAIL  storeEncryption > checkEncryptionKeyIntegrity > handles writeFileSync failure on first run gracefully
  Expected: { changed: false, isFirstRun: true }
  Received: { changed: false, isFirstRun: false }
```

## Root Cause

The test file declares mock variables (`mkdirSyncMock`, `existsSyncMock`, `readFileSyncMock`, `writeFileSyncMock`) as `const vi.fn()` *before* the `vi.mock()` call. Because `vi.mock()` is **hoisted** to the top of the file by Vitest's transformer, the mock factory runs before the `const` declarations execute. The factory captures variable bindings via closure, but the factory is async and the module may already be cached from a previous test run with different mock state, causing test isolation to break.

The concrete effect is that some calls inside `checkEncryptionKeyIntegrity()` do not route through the mock functions as expected — they may land on the real `fs` module or on stale mock state.

## Recommended Fix (not yet applied)

1. Replace `const mkdirSyncMock = vi.fn()` declarations with `vi.hoisted(() => ({ ... }))` to safely initialize mock variables before hoisted `vi.mock()` factory runs.
2. Add `vi.isolateModules()` wrapper in each test (or use `vi.resetModules()` in `beforeEach`) to clear the module cache between tests so `storeEncryption.ts` is re-evaluated fresh with each test's mock state.

**Reference:** Vitest docs — [vi.hoisted()](https://vitest.dev/api/vi#vi-hoisted), [vi.mock() hoisting](https://vitest.dev/api/vi#vi-mock)

## Example Fix Pattern

```ts
const { mkdirSyncMock, existsSyncMock, readFileSyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  mkdirSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, mkdirSync: mkdirSyncMock, existsSync: existsSyncMock, readFileSync: readFileSyncMock, writeFileSync: writeFileSyncMock }
})
```
