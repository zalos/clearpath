# BUG-024: workspaceHandlers — require() for os, path, fs inside clone handler

**File:** `src/main/ipc/workspaceHandlers.ts`  
**Severity:** Low — works at runtime but inconsistent with static imports at top of file  
**Discovered:** April 2026, IPC handler unit test coverage  

## Symptom

The `workspace:clone-repo` handler uses CJS `require()` to load modules that are either already imported at the top of the file (partially) or could be:

1. **Line 167:** `require('os').homedir()` — `os` is not imported at all at the top of the file.
2. **Line 168:** `require('path').join` — `path` is already imported at line 4 but only `basename` and `resolve` are destructured; `join` is not included.
3. **Line 194:** `require('fs').mkdirSync` — `fs` is already imported at line 3 but only `existsSync` and `statSync` are destructured; `mkdirSync` is not included.
4. **Line 195:** `require('path').dirname` — same as line 168, `dirname` is not in the static import.

## Root Cause

The clone-repo handler was likely added after the initial module imports were established. Rather than updating the static imports, the developer used inline `require()` calls. This works in Electron's CJS main process but:

- Breaks consistency with the rest of the file's import style
- Cannot be properly mocked in ESM-first test environments without extra workarounds
- Will fail if the project migrates to native ESM

Unlike BUG-023, these `require()` calls target Node.js built-in modules (`os`, `path`, `fs`) rather than `electron`, so they work correctly in Vitest (Node.js built-ins are always available via `require()`). This makes the bug lower severity since it does not block testing.

## Recommended Fix

Add the missing imports to the existing static import statements:

```typescript
// Line 3: Add mkdirSync
import { existsSync, statSync, mkdirSync } from 'fs'

// Line 4: Add join and dirname
import { basename, resolve, join, dirname } from 'path'

// Add new import for os
import { homedir } from 'os'

// Line 167-168: Replace require calls
const home = homedir()
cloneDir = join(home, 'ClearPath-repos', safeWsName, repoName)

// Lines 194-195: Replace require calls
mkdirSync(dirname(cloneDir), { recursive: true })
```

## Impact

- No user-facing impact — Node.js built-in `require()` works in all current environments
- Tests are not blocked (unlike BUG-023) since these are standard Node.js modules
- Code cleanliness and consistency issue
- Same pattern as BUG-012 and BUG-023, indicating a recurring habit of using inline `require()` instead of updating static imports
