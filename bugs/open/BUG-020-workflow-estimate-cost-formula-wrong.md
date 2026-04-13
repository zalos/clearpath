# BUG-020: workflowHandlers — Cost estimation formula uses combined totalTokens instead of separate input/output tokens

**Discovered:** April 10, 2026
**File:** `src/main/ipc/workflowHandlers.ts`
**Severity:** Low (estimation only, no billing impact)

## Symptom

The `workflow:estimate-cost` handler produces cost estimates that don't match the documented pricing model. The intent (per the comment) is to apply $3/M to input tokens and $15/M to output tokens, but the actual formula applies those rates to fractions of the combined total.

## Root Cause

On line 98, the formula is:

```typescript
const cost = (totalTokens / 3) * 3 / 1_000_000 + (totalTokens * 2 / 3) * 15 / 1_000_000
```

`totalTokens` is already `inputTokens + outputTokens` (computed in the loop above). The formula then divides `totalTokens` by 3 to approximate the "input share" and multiplies by 2/3 for the "output share". This simplifies to:

```
cost = totalTokens * 1 / 1_000_000 + totalTokens * 10 / 1_000_000
     = totalTokens * 11 / 1_000_000
```

But the correct formula using the individual token counts already available in the loop would be:

```
cost = inputTokens * 3 / 1_000_000 + outputTokens * 15 / 1_000_000
```

Since `outputTokens = inputTokens * 2`, the correct cost per step is:

```
cost = inputTokens * 3 / 1_000_000 + (inputTokens * 2) * 15 / 1_000_000
     = inputTokens * 33 / 1_000_000
```

The current formula produces `inputTokens * 3 * 11 / 1_000_000 = inputTokens * 33 / 1_000_000` (since `totalTokens = 3 * inputTokens`), so the final dollar amount is coincidentally the same. However, the code is misleading and fragile — if the input/output ratio changes from the current hardcoded 1:2, the formula will break silently.

## Recommended Fix

Accumulate `inputTokens` and `outputTokens` separately and apply pricing directly:

```typescript
let totalInputTokens = 0
let totalOutputTokens = 0
for (const step of args.steps) {
  const inputTokens = Math.ceil(step.prompt.length / 4)
  const outputTokens = inputTokens * 2
  totalInputTokens += inputTokens
  totalOutputTokens += outputTokens
}
const cost = totalInputTokens * 3 / 1_000_000 + totalOutputTokens * 15 / 1_000_000
return {
  totalTokens: totalInputTokens + totalOutputTokens,
  estimatedCost: cost,
  stepCount: args.steps.length,
}
```

This makes the formula self-documenting and resilient to future changes in the output multiplier or per-model pricing.
