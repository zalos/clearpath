# BUG-019: skillHandlers.ts — Copilot project skills scan searches entire .github directory

**Discovered:** April 10, 2026  
**File:** `src/main/ipc/skillHandlers.ts`  
**Severity:** Medium

## Description

In `listAllSkills()` (line 151), the copilot project skill scan calls:

```typescript
skills.push(...scanSkillDir(join(workingDirectory, '.github'), 'project', 'copilot'))
```

This scans the entire `.github/` directory for SKILL.md files. The `scanSkillDir` function enumerates all entries in the directory and recurses into subdirectories looking for `SKILL.md`.

In a typical GitHub repository, `.github/` contains directories like `workflows/`, `ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE/`, and `actions/`. If any of these directories (or their subdirectories) happen to contain a file named `SKILL.md`, it would be incorrectly discovered as a copilot skill.

## Expected Behavior

The scan should target `.github/skills/` (or a copilot-specific subdirectory) rather than the entire `.github/` directory, consistent with how Claude skills are scoped to `.claude/skills/`.

```typescript
// Should be:
skills.push(...scanSkillDir(join(workingDirectory, '.github', 'skills'), 'project', 'copilot'))
```

## Impact

- False positive skill discovery from unrelated `.github/` subdirectories
- Performance: unnecessarily scans workflow files, issue templates, etc.
- Could surface confusing entries in the Skills UI if a repo happens to have SKILL.md in `.github/workflows/` or similar
