# BUG-007: handoff.ts — matchesTriggerCondition keyword overlap causes wrong handoff routing

**Discovered:** April 9, 2026  
**File:** `src/main/starter-pack/handoff.ts`  
**Severity:** Medium

## Description

The `matchesTriggerCondition` method in `AgentHandoffService` uses keywords extracted from the trigger's *condition description text* to decide which signal category to check (communication, research, planning, etc.). 

The research-analyst's first trigger (targeting `strategy-decision-partner`) contains the word "findings" in its condition text, which causes it to also match the communication signals branch. This means communication signals always match trigger 1 before trigger 2 gets evaluated, making it impossible for `research-analyst` to hand off to `communication-coach` via the keyword matching system.

## Impact

- The research-analyst agent cannot properly suggest handoffs to communication-coach
- Keyword-based trigger matching has unintended cross-category overlaps
- The order of trigger evaluation matters more than it should
