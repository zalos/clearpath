# BUG-025: policyHandlers — blocked tool glob matching uses naive string replacement

**File:** `src/main/ipc/policyHandlers.ts`  
**Line:** 155  
**Severity:** Medium — policy enforcement bypass possible with crafted tool names  
**Discovered:** 2026-04-10, unit test coverage initiative  

## Symptom

The `policy:check-action` handler's blocked tool matching uses a simplistic approach:

```typescript
rules.blockedTools.some((b) => tool.includes(b.replace('*', '')))
```

For the Cautious preset's `blockedTools: ['shell(rm:*)', 'shell(sudo:*)', 'shell(chmod:*)']`:
- `'shell(rm:*)'.replace('*', '')` produces `'shell(rm:)'`
- Then `tool.includes('shell(rm:)')` checks if the tool string contains that substring

This has two problems:

1. **Only first `*` is replaced.** `String.replace` with a string pattern only replaces the first occurrence. A pattern like `shell(*:*)` would produce `shell(:*)`, not `shell(:)`. This is not currently exploited by builtin presets but would break user-defined patterns with multiple wildcards.

2. **Substring matching is overly broad AND too narrow.** A blocked tool `'shell(rm:*)'` would also match `'not-a-shell(rm:foo)'` (overly broad). Conversely, `'shell(rm -rf /)'` does NOT match because the pattern `shell(rm:)` doesn't contain the space-separated form (too narrow). The matching assumes a colon-delimited tool name format that may not match all CLI tool invocation patterns.

## Expected Behavior

The blocked tool matching should use proper glob matching (e.g., `minimatch` or at minimum handle `*` as a glob-style wildcard with anchored matching), not naive substring containment after star removal.

## Reproduction

```typescript
// This tool SHOULD be blocked by 'shell(rm:*)' but is NOT:
const tool = 'shell(rm -rf /)'
const blocked = 'shell(rm:*)'
const result = tool.includes(blocked.replace('*', ''))
// blocked.replace('*', '') === 'shell(rm:)'
// 'shell(rm -rf /)'.includes('shell(rm:)') === false
```

## Impact

A user could potentially bypass tool restrictions by using tool name formats that don't match the naive substring check. For example, the Standard preset blocks `'shell(rm -rf:*)'` but this pattern would never match a tool called `'shell(rm -rf /)'` because `'shell(rm -rf:)'.includes(...)` checks the wrong substring.

## Suggested Fix

Replace the naive string replacement with proper glob matching:
```typescript
import { minimatch } from 'minimatch'
// or implement basic glob: replace * with .*, anchor with ^ and $, use RegExp
if (tool && rules.blockedTools.some((pattern) => minimatch(tool, pattern)))
```
