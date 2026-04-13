# BUG-006: skills.ts — Document Builder and Concept Explainer have empty primaryAgents

**Discovered:** April 9, 2026  
**File:** `src/main/starter-pack/skills.ts`  
**Severity:** Low

## Description

The "Document Builder" and "Concept Explainer" skills in `STARTER_SKILLS` have `primaryAgents: []` (empty arrays), while every other skill has at least one primary agent. This means no agent is designated as a primary user of these skills, which may affect handoff or skill-routing logic.

## Impact

- Skills may not be recommended to any agent during handoff evaluation
- Could be intentional (skills available to all agents) or an oversight
