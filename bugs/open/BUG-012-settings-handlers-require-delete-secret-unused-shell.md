# BUG-012: settingsHandlers — require() for deleteSecret + unused shell import

**File:** `src/main/ipc/settingsHandlers.ts`  
**Severity:** Low — functional but inconsistent, potential ESM breakage  
**Discovered:** April 2026, IPC handler unit test coverage  

## Symptom

Two code quality issues in settingsHandlers.ts that do not cause runtime failures today but represent latent problems:

1. **`require()` for `deleteSecret`**: When clearing a sensitive env var (line 280), `deleteSecret` is loaded via `require('../utils/credentialStore')` instead of being statically imported alongside the other credentialStore functions at line 9 (`storeSecret`, `retrieveSecret`, `hasSecret`, `getSecretPreview`).

2. **Unused `shell` import**: The `shell` module is imported from `electron` at line 2 but never referenced anywhere in the file. It was likely used in an earlier version of `settings:open-terminal` that called `shell.openPath()` but was replaced with `execFile('open', ...)` for security reasons.

## Root Cause

### Issue 1: require() vs import
The `deleteSecret` function was likely added to the clearing path after the initial imports were written, and the developer used `require()` as a quick fix rather than adding it to the static import on line 9. This works in CommonJS (Electron main process) but:
- Breaks consistency — the same module is both `import`ed and `require()`d
- Will fail if the project ever migrates to ESM (`require` is not available in ESM)
- Makes dependency analysis tools miss this usage
- Confuses vi.mock in test environments (the `require()` may bypass mocked module boundaries)

### Issue 2: Unused import
Dead import that should be cleaned up. No functional impact.

## Recommended Fix

```typescript
// Line 9: Add deleteSecret to the static import
import { storeSecret, retrieveSecret, hasSecret, getSecretPreview, deleteSecret } from '../utils/credentialStore'

// Line 2: Remove unused shell import
import { dialog } from 'electron'

// Line 280: Replace require() with direct call
if (args.value) {
  storeSecret(`env-${args.key}`, args.value)
} else {
  deleteSecret(`env-${args.key}`)
}
```

## Impact

- No user-facing impact currently
- The `require()` call does work at runtime in Electron's CJS environment
- The unused `shell` import adds negligible bundle overhead
- Both are easy single-line fixes
