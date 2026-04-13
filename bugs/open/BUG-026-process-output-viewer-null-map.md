# BUG-026: ProcessOutputViewer — .map() called on null from subagent:get-output

**File:** `src/renderer/src/components/subagent/ProcessOutputViewer.tsx`  
**Line:** 20  
**Severity:** Medium — causes unhandled promise rejection; component may not render correctly  
**Discovered:** 2026-04-10, unit test coverage initiative  

## Symptom

When `window.electronAPI.invoke('subagent:get-output', { id: subAgentId })` returns `null` (e.g., when the sub-agent ID doesn't exist or the handler returns null for unknown agents), the code immediately calls `.map()` on the result, causing a `TypeError: Cannot read properties of null (reading 'map')`.

This is an unhandled promise rejection inside a `useEffect`, which:
1. Crashes the async callback silently (no user-visible error)
2. Leaves the component in a loading state permanently (`setLoading(false)` is never called)
3. Triggers Vitest's unhandled rejection detection, causing the test suite to report an error

## Reproduction

Render the `ProcessOutputViewer` component with a `subAgentId` that doesn't correspond to a running or completed sub-agent. The `subagent:get-output` handler returns `null`, and the `.map()` call throws.

## Suggested Fix

Add a null/undefined guard before calling `.map()`:

```typescript
const log = await window.electronAPI.invoke('subagent:get-output', { id: subAgentId }) as ParsedOutput[] | null
const msgs: OutputMessage[] = (log ?? []).map((output, i) => ({
  id: String(i),
  output,
}))
```
