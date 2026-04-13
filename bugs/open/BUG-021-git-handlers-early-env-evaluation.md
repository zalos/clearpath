# BUG-021: gitHandlers — GIT_OPTS.env evaluated at module load time before initShellEnv()

**Discovered:** April 10, 2026
**File:** `src/main/ipc/gitHandlers.ts`
**Severity:** Medium (may cause git commands to fail if git is not on the bare system PATH)

## Symptom

Git operations (status, log, diff, worktrees, etc.) may fail with `ENOENT` or use the wrong PATH on macOS, because the environment for child processes is captured before the login shell PATH has been resolved.

## Root Cause

On line 10, `GIT_OPTS` is a module-level constant:

```typescript
const GIT_OPTS = { timeout: 15000, env: getScopedSpawnEnv('copilot') }
```

`getScopedSpawnEnv()` internally reads from the cached `_env` variable, which is populated by `initShellEnv()`. However, `initShellEnv()` is async and runs during app startup. If `gitHandlers.ts` is imported (and thus evaluated) before `initShellEnv()` has resolved, `_env` is still `null`, and `getScopedSpawnEnv()` falls back to `process.env` — the bare system PATH that macOS GUI apps receive, which typically lacks Homebrew, nvm, and user bin directories.

This means `GIT_OPTS.env` is frozen to whatever `process.env` looked like at import time, and even if `initShellEnv()` resolves later, git operations continue using the stale env.

## Impact

- On macOS, if `git` is installed via Homebrew (`/opt/homebrew/bin/git`) and the app is launched from Finder/Dock, git commands will fail with `spawn git ENOENT`.
- Custom env vars set later via `setCustomEnvVars()` will never be picked up by git operations.

## Recommended Fix

Evaluate the env lazily inside the `git()` helper function instead of at module scope:

```typescript
async function git(args: string[], cwd: string): Promise<string> {
  const env = getScopedSpawnEnv('copilot')
  const { stdout } = await execFileAsync('git', args, { timeout: 15000, env, cwd })
  return stdout.trim()
}
```

This ensures each git call gets the current env, including the login-shell PATH if `initShellEnv()` has completed.
