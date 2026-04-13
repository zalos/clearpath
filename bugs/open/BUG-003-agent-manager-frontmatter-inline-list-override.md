# BUG-003: AgentManager.parseFrontmatter — inline comma list overrides list block when both present

**File:** `src/main/agents/AgentManager.ts`, function `parseFrontmatter()` (unexported)  
**Severity:** Low — affects only malformed/unusual frontmatter inputs  
**Discovered:** April 2026, unit test coverage initiative  

## Symptom

If an agent `.md` file contains a key in front matter with an inline comma-separated list (e.g., `tools: Read, Write`) followed by a block list for the same key, the block list is appended to the inline list instead of replacing it.

## Root Cause

The parser processes lines sequentially and `flushList()` only flushes when encountering a new key, so a `key:` with a value and then subsequent `- item` lines for a *different* key would incorrectly append to the previously set key if the YAML is structured that way.

```yaml
# Example malformed frontmatter that triggers the bug:
tools: Read, Write
- Execute
```

The `- Execute` line would be appended to the `tools` key's inline list value rather than being parsed as a separate list or ignored.

## Recommended Fix (not yet applied)

Call `flushList()` before setting any inline or value-bearing key in the `kvMatch` branch, not just at the start of the `kvMatch` block. This ensures any trailing list items from the previous key are committed before processing the new key's inline value.
