# BUG-002: NotificationManager — quiet-hours boundary condition: midnight-spanning ranges

**File:** `src/main/notifications/NotificationManager.ts`, method `shouldDesktopPush()`  
**Severity:** Low — only affects edge case in overnight quiet-hours windows  
**Discovered:** April 2026, unit test coverage initiative  

## Symptom

Quiet hours defined as e.g. `22:00–07:00` (overnight) use the comparison:

```ts
hhmm >= quietHoursStart || hhmm < quietHoursEnd
```

However, if both `start` and `end` are the same value (e.g., `"00:00"`–`"00:00"`), quiet hours is always active, which is incorrect — the user likely wants quiet hours disabled (zero-length window). The current logic treats equal start/end as "all day quieted" when the overnight branch triggers.

## Root Cause

The overnight quiet-hours check `hhmm >= quietHoursStart || hhmm < quietHoursEnd` evaluates to `true` for all times when `quietHoursStart === quietHoursEnd` because every `hhmm` is either `>= start` OR `< end` (which is the same value). This means any configuration with start == end silently silences all notifications.

## Recommended Fix (not yet applied)

Add a guard: if `quietHoursStart === quietHoursEnd`, treat as "no quiet hours" (return `true` always).

```ts
// Guard: equal start/end means disabled
if (quietHoursStart === quietHoursEnd) return true
```
