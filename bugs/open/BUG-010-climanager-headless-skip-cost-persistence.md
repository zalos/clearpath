# BUG-010: CLIManager — Headless sessions skip cost estimation and persistence on exit

**Discovered:** April 9, 2026  
**File:** `src/main/cli/CLIManager.ts`  
**Severity:** Medium

## Description

In `attachListeners()`, the exit event handler has an early return `if (!wc || wc.isDestroyed()) return` that silently skips cost estimation and session persistence when no WebContents is available. This means headless/background sessions (sub-agents, scheduled tasks) never record costs or persist their final state.

## Impact

- Sub-agent sessions spawned without a renderer window won't have costs tracked
- Scheduled task sessions won't persist their completion state
- Cost tracking dashboard may underreport actual usage
- May be intentional behavior, but worth investigating
