# Bug 002: Turn elapsed-time log uses session start time instead of turn start time

**File:** `src/main/cli/CLIManager.ts`
**Severity:** Medium
**Discovered by:** Unit test — `tests/CLIManager.test.ts`

## Description

In the `exit` handler attached in `attachListeners`, the elapsed duration is
computed from the session creation timestamp (`session.info.startedAt`) rather
than from the moment the current turn was spawned:

```typescript
// ❌ measures time since the SESSION started, not since THIS TURN started
const duration = Date.now() - (session.info.startedAt ?? Date.now())
log.info(`… elapsed=${Math.round(duration / 1000)}s`)
```

## Impact

- On **turn 1** the value happens to be approximately correct (session was just
  created).
- On **turn 2+** the `elapsed` figure accumulates all prior turns as well,
  making it larger than the actual per-turn response time.
- Developers and support staff reading logs will see misleadingly large elapsed
  values and may incorrectly diagnose performance problems or SLA breaches.

## Reproduction

1. Start a session and send two or more messages.
2. Observe the `[CLIManager] turn complete` log lines — the `elapsed` value for
   turn 2 includes turn 1's duration.

## Fix

Track when each turn starts in `runTurn` and use that timestamp in the `exit`
handler.  A new `turnStartedAt` field on `ActiveSession` (or a local variable
captured in the closure) provides the correct reference point.

```typescript
// In runTurn — record when this turn begins
session.turnStartedAt = Date.now()

// In attachListeners exit handler — measure from turn start
const duration = Date.now() - (session.turnStartedAt ?? Date.now())
```

---

## Resolution

**Status:** Closed — Fixed  
**Fixed in:** `src/main/cli/types.ts`, `src/main/cli/CLIManager.ts`  
**Commit:** fix: track per-turn start time to fix elapsed-time in turn-complete log

Added `turnStartedAt?: number` to `ActiveSession`.  `runTurn` now sets
`session.turnStartedAt = Date.now()` before spawning the child process, and
the `exit` handler uses `session.turnStartedAt` (instead of
`session.info.startedAt`) to compute the per-turn elapsed time.  Covered by
tests in `tests/CLIManager.test.ts`.
