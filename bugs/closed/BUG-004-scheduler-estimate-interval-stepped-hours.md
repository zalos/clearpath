# BUG-004: SchedulerService.estimateIntervalMs — stepped hour patterns misclassified as daily

**File:** `src/main/scheduler/SchedulerService.ts`, method `estimateIntervalMs()` (private)  
**Severity:** Low — affects missed-run detection accuracy only  
**Discovered:** April 2026, unit test coverage initiative  

## Symptom

For cron expressions like `0 */2 * * *` (every 2 hours), the method incorrectly returns `86400000` (24 hours / daily interval) instead of the correct 2-hour interval.

## Root Cause

The method checks hourly vs daily via:

```ts
// Hourly check (only matches exact '*')
parts[0] === '0' && parts[1] === '*'

// Daily check (matches anything that's not exactly '*')
parts[0] === '0' && parts[1] !== '*'
```

For `0 */2 * * *`, `parts[1]` is `'*/2'` which is not exactly `'*'`, so it falls into the **daily** branch and returns `86400000` instead of a 2-hour interval. The hourly check is too strict — it only works when `parts[1]` is exactly `'*'`.

## Impact

`estimateIntervalMs()` is used by `checkMissedRuns()` to detect jobs that should have run but didn't (e.g., when the app was closed). An incorrect interval causes missed-run detection to fire too infrequently or too often for stepped-interval patterns.

## Recommended Fix (not yet applied)

Use a more robust parsing approach. At minimum, check whether `parts[1]` contains `'*'` rather than requiring an exact match:

```ts
// Hourly: minute=0 and hour field uses '*' (e.g., '*/2', '*', '*/3')
parts[0] === '0' && parts[1].includes('*')
```

Or use a cron parsing library to accurately compute the interval between executions.
