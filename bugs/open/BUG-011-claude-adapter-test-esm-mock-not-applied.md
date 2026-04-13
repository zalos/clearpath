# BUG-011: ClaudeCodeAdapter.test.ts — `resolveInShellMock` and `existsSyncMock` not applied at runtime

**Discovered:** April 10, 2026
**File:** `src/main/cli/ClaudeCodeAdapter.test.ts`
**Severity:** Medium (test-only, no production impact)

## Failing Tests (5)

- `isInstalled > returns true and sets binaryPath when resolveInShell returns a path`
- `isInstalled > returns false when resolveInShell returns null`
- `isAuthenticated > returns true when .credentials.json exists in ~/.claude`
- `isAuthenticated > returns true when auth.json exists in ~/.claude`
- `isAuthenticated > checks both .credentials.json and auth.json paths`

## Symptom

```
FAIL  isInstalled > returns true and sets binaryPath when resolveInShell returns a path
  Expected: '/usr/local/bin/claude'
  Received: '/Users/jaredkremer/.nvm/versions/node/.../claude'   ← real binary

FAIL  isInstalled > returns false when resolveInShell returns null
  Expected: false
  Received: true   ← real resolveInShell found the real claude binary

FAIL  isAuthenticated > returns true when .credentials.json exists in ~/.claude
  Expected: true
  Received: false   ← existsSyncMock.mockImplementation not applied
```

## Root Cause

`ClaudeCodeAdapter.ts` imports `resolveInShell` from `../utils/shellEnv` and `existsSync` from `fs`. Even though the test file uses `vi.hoisted()` + `vi.mock()` — the correct pattern — the mocks are not being applied to the already-resolved bindings inside `ClaudeCodeAdapter`. This is the same class of ESM mock hoisting / module-caching issue documented in BUG-001, but here the module is a direct production module (`ClaudeCodeAdapter.ts`) rather than a utility.

The likely cause is that `ClaudeCodeAdapter` captures the import references at module evaluation time and Vitest's module cache does not re-evaluate the module after the mock factory replaces the exports, leaving the adapter holding a reference to the real functions.

## Related

- **BUG-001** (`storeEncryption.test.ts`) — same root-cause pattern, different file
- **BUG-005** (`ClaudeCodeAdapter.test.ts`) — `afterEach` assignment bug in the same file (separate issue; causes env-var pollution but is not the direct cause of these test failures)

## Recommended Fix (not yet applied)

Add `vi.resetModules()` + a dynamic `import()` of `ClaudeCodeAdapter` inside each test's `beforeEach`, so every test gets a freshly-evaluated module that sees only the current mock state:

```ts
let adapter: ClaudeCodeAdapter

beforeEach(async () => {
  vi.resetModules()
  const { ClaudeCodeAdapter } = await import('./ClaudeCodeAdapter')
  adapter = new ClaudeCodeAdapter()
})
```

Alternatively, wrap each affected test in `vi.isolateModules()`.

**Reference:** Vitest docs — [vi.resetModules()](https://vitest.dev/api/vi#vi-resetmodules), [vi.isolateModules()](https://vitest.dev/api/vi#vi-isolatemodules)
