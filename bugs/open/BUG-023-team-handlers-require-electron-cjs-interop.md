# BUG-023: teamHandlers — require('electron') CJS interop breaks in test and ESM contexts

**File:** `src/main/ipc/teamHandlers.ts`  
**Severity:** Medium — causes runtime crashes when `require('electron')` returns an unexpected shape, and prevents proper unit testing of 3 handlers  
**Discovered:** April 2026, IPC handler unit test coverage  

## Symptom

Three handler functions in `teamHandlers.ts` use `require('electron')` inside function bodies instead of using the static `import { dialog } from 'electron'` already at the top of the file:

1. **`exportConfigBundle()`** (line 176): `require('electron').app.getPath('userData')` — crashes when CJS interop returns a module wrapper without `app` as a direct property.

2. **`importConfigBundle()`** (line 240): `const { app } = require('electron')` — same issue, plus this runs after file validation logic, meaning the handler partially executes before crashing.

3. **`team:apply-shared-config`** handler (line 348): `const { app } = require('electron')` — same pattern, only reached when `data['settings']` is present.

In Vitest with the electron mock alias (`src/test/electron-mock.ts`), `require('electron')` goes through CJS interop which wraps ESM default exports in `{ default: ... }`, losing the named exports (`app`, `dialog`, etc.). This causes `TypeError: Cannot read properties of undefined (reading 'getPath')`.

## Root Cause

The file already has `import { dialog } from 'electron'` at the top (line 2), which works correctly through the vitest alias and in Electron's ESM-compatible module system. The `require()` calls were likely added later as a convenience to avoid adding `app` to the static import.

In Electron's main process at runtime, `require('electron')` returns the full Electron module with all named exports, so this works by accident. However:

- It fails in any ESM-first test environment (Vitest, Jest with ESM transform)
- It fails if the project migrates to native ESM (`require` is not available)
- It creates an inconsistency where the same module is both `import`ed and `require()`d
- It prevents full unit test coverage of export/import bundle functionality

## Recommended Fix

Add `app` to the existing static import and remove all `require('electron')` calls:

```typescript
// Line 2: Change from:
import { dialog } from 'electron'
// To:
import { app, dialog } from 'electron'

// Line 176: Change from:
join(require('electron').app.getPath('userData'), `${name}.json`),
// To:
join(app.getPath('userData'), `${name}.json`),

// Line 240: Remove:
const { app } = require('electron')
// (app is now available from the static import)

// Line 348: Remove:
const { app } = require('electron')
// (app is now available from the static import)
```

## Impact

- **3 IPC handlers are untestable** in their primary code paths due to this issue
- Unit tests for `team:export-bundle`, `team:import-bundle`, and `team:apply-shared-config` must work around the crash by testing only validation paths that execute before the `require()` call
- At runtime in Electron, the code works because Electron's CJS `require()` returns the full module — but this is fragile and depends on Electron's internal module system behavior
- Same pattern as BUG-012 (settingsHandlers `require()` for `deleteSecret`), suggesting this is a recurring codebase habit
