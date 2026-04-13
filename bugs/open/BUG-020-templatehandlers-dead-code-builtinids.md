# BUG-020: templateHandlers.ts — Unused variable `builtinIds` in getAllTemplates

**Discovered:** April 10, 2026  
**File:** `src/main/ipc/templateHandlers.ts`  
**Severity:** Low (dead code, no functional impact)

## Description

In `getAllTemplates()` (line 182), a `builtinIds` Set is computed but never referenced:

```typescript
function getAllTemplates(): PromptTemplate[] {
  const user = store.get('templates')
  const builtinIds = new Set(BUILTIN_TEMPLATES.map((t) => t.id))  // <-- never used
  // Merge: user templates override built-in if same ID
  const userIds = new Set(user.map((t) => t.id))
  const builtins = BUILTIN_TEMPLATES.filter((t) => !userIds.has(t.id))
  return [...builtins, ...user]
}
```

The merge logic correctly uses `userIds` to filter out builtins that have been overridden by user templates. `builtinIds` is dead code — likely a leftover from an earlier implementation that checked for collisions in both directions.

## Impact

- Wasted Set construction on every `getAllTemplates()` call (minor perf)
- Code readability: the unused variable suggests there should be additional logic that was forgotten or removed
- Would trigger a linter warning with `no-unused-vars`
