# BUG-009: SchedulerService — Weekly cron expressions misclassified as daily in estimateIntervalMs

**Discovered:** April 9, 2026  
**File:** `src/main/scheduler/SchedulerService.ts`  
**Severity:** Medium

## Description

Weekly cron expressions with `minute=0` and a specific hour (e.g., `0 9 * * 1`, `0 17 * * 5`) are misclassified as **daily** by `estimateIntervalMs()` because the `parts[0]==='0' && parts[1]!=='*'` check fires before `parts[4]!=='*'` is evaluated. 

The order of pattern matching checks means the daily pattern matches first, preventing the weekly pattern from being reached.

## Impact

- Weekly jobs are estimated as daily intervals
- `checkMissedRuns()` uses `estimateIntervalMs()`, so weekly jobs will produce false-positive missed run alerts after just ~2 days instead of ~7 days
- Affects scheduling accuracy notifications
