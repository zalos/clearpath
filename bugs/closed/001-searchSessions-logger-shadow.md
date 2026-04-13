# Bug 001: `searchSessions` uses confusing variable name `log` that shadows the module logger

**File:** `src/main/cli/CLIManager.ts`
**Severity:** Medium (code quality / latent bug risk)
**Discovered by:** Unit test — `tests/CLIManager.test.ts`

## Description

Inside `searchSessions`, the message-log array for each session is stored in a
variable named `log` (line 199), shadowing the module-level `log` logger:

```typescript
// ❌ shadows the logger imported at the top of the file
const log = session.messageLog ?? []
for (let i = 0; i < log.length; i++) { … }
```

Due to JavaScript's block-scoping of `const`, the outer `log` (logger) is
correctly restored after the loop body ends, so the `log.debug(...)` call on
line 217 does not currently throw.  However:

1. **Latent bug risk**: Any future code added *inside* the for loop that
   intends to call `log.debug/info/warn/error` will silently call an array
   method that doesn't exist instead, causing a runtime TypeError.
2. **Confusing to readers**: Developers maintaining this code may believe
   that `log.debug(…)` after the loop uses the last session's message array,
   leading to incorrect assumptions and mistakes during future changes.
3. **TypeScript shadow lint**: ESLint `no-shadow` (commonly added to TS
   projects) flags this pattern as an error.

## Impact

While not a crash today, this code smell increases the chance of introducing
a real bug whenever the loop body is modified, and makes the code harder to
understand at a glance.

## Reproduction

1. Read `searchSessions` in `CLIManager.ts`.
2. Note the inner `const log` and the outer `log.debug` call — without careful
   attention to block scoping they appear to be the same variable.

## Fix

Rename the inner variable from `log` to `messages` (or any name that does not
shadow the outer logger).

```typescript
// ✅ renamed to avoid shadowing
const messages = session.messageLog ?? []
for (let i = 0; i < messages.length; i++) {
  const entry = messages[i]
  …
}
```

---

## Resolution

**Status:** Closed — Fixed  
**Fixed in:** `src/main/cli/CLIManager.ts`  
**Commit:** fix: rename inner `log` → `messages` in searchSessions loop to eliminate logger shadow

Renamed the inner variable from `log` to `messages` throughout the
`searchSessions` loop body, eliminating the name collision with the
module-level `log` logger.  Covered by regression test in
`tests/CLIManager.test.ts`.
