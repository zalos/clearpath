# Bug 003: Unused variable `agentWasExplicit` in IPC handler

**File:** `src/main/ipc/handlers.ts`
**Severity:** Low
**Discovered by:** TypeScript strict compilation / unit test — `tests/CLIManager.test.ts`

## Description

Line 41 in `handlers.ts` declares a variable that is never read:

```typescript
let agentWasExplicit = !!resolved.agent  // ← declared but never referenced
```

TypeScript strict mode (`"strict": true` in `tsconfig.main.json`) includes
`noUnusedLocals`, so this produces a compile-time error in strict builds and
indicates dead code left over from a refactor.

## Impact

- Causes a TypeScript compile error in strict mode.
- The value is computed unnecessarily on every session start, adding noise to
  the code and making future readers wonder what logic was intended.

## Reproduction

```bash
npx tsc --noEmit -p tsconfig.main.json
# error TS6133: 'agentWasExplicit' is declared but its value is never read.
```

## Fix

Remove the unused variable declaration.

```diff
- let agentWasExplicit = !!resolved.agent
  if (!agentId && agentManager) {
```

---

## Resolution

**Status:** Closed — Fixed  
**Fixed in:** `src/main/ipc/handlers.ts`  
**Commit:** fix: remove unused `agentWasExplicit` variable in IPC handler

Removed the `let agentWasExplicit = !!resolved.agent` declaration that was
assigned but never read.  This eliminates the dead code and resolves the
TypeScript `noUnusedLocals` warning.
