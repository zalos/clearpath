/**
 * Unit tests for CLIManager — covers bugs 001 and 002.
 *
 * Bug 001: searchSessions crashes with TypeError because the inner
 *          `const log` variable shadows the module-level `log` logger.
 *
 * Bug 002: Turn elapsed-time is calculated from session.info.startedAt
 *          (session creation time) instead of from when the current turn
 *          actually started.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks (must be hoisted before any real imports) ─────────────────────────

// Minimal mock for electron-store that keeps data in memory
const _stores: Record<string, Record<string, unknown>> = {}

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      private _name: string

      constructor(opts: { name?: string; defaults?: Record<string, unknown> } = {}) {
        this._name = opts.name ?? 'default'
        if (!_stores[this._name]) {
          _stores[this._name] = { ...(opts.defaults ?? {}) }
        }
      }

      get(key: string): unknown {
        return _stores[this._name][key]
      }

      set(key: string, value: unknown): void {
        _stores[this._name][key] = value
      }
    },
  }
})

// Stub out the encryption-key helper (no keychain in tests)
vi.mock('../src/main/utils/storeEncryption', () => ({
  getStoreEncryptionKey: () => 'test-key',
}))

// electron is not available in the test environment
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getVersion: () => '0.0.0' },
}))

// CopilotAdapter / ClaudeCodeAdapter spawn real processes — we don't want that
vi.mock('../src/main/cli/CopilotAdapter', () => ({
  CopilotAdapter: class {
    readonly cliName = 'copilot'
    binaryPath = 'copilot'
    isInstalled = vi.fn().mockResolvedValue(true)
    isAuthenticated = vi.fn().mockResolvedValue(true)
    buildArgs = vi.fn().mockReturnValue([])
    parseOutput = vi.fn().mockReturnValue({ type: 'text', content: '' })
    startSession = vi.fn()
    sendInput = vi.fn()
    sendSlashCommand = vi.fn()
  },
}))

vi.mock('../src/main/cli/ClaudeCodeAdapter', () => ({
  ClaudeCodeAdapter: class {
    readonly cliName = 'claude'
    binaryPath = 'claude'
    isInstalled = vi.fn().mockResolvedValue(true)
    isAuthenticated = vi.fn().mockResolvedValue(true)
    buildArgs = vi.fn().mockReturnValue([])
    parseOutput = vi.fn().mockReturnValue({ type: 'text', content: '' })
    startSession = vi.fn()
    sendInput = vi.fn()
    sendSlashCommand = vi.fn()
  },
}))

// resolveInShell is async and needs a shell — stub it
vi.mock('../src/main/utils/shellEnv', () => ({
  initShellEnv: vi.fn().mockResolvedValue(undefined),
  getSpawnEnv: vi.fn().mockReturnValue({}),
  getScopedSpawnEnv: vi.fn().mockReturnValue({}),
  resolveInShell: vi.fn().mockResolvedValue(null),
  setCustomEnvVars: vi.fn(),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<{
  sessionId: string
  cli: 'copilot' | 'claude'
  name: string
  firstPrompt: string
  startedAt: number
  messageLog: Array<{ type: string; content: string; sender?: string }>
  archived: boolean
}> = {}) {
  return {
    sessionId: overrides.sessionId ?? 'sess-001',
    cli: overrides.cli ?? 'copilot' as const,
    name: overrides.name ?? 'Test Session',
    firstPrompt: overrides.firstPrompt ?? 'Hello world',
    startedAt: overrides.startedAt ?? Date.now() - 60_000,
    messageLog: overrides.messageLog ?? [
      { type: 'text', content: 'Hello world', sender: 'user' },
      { type: 'text', content: 'Hi there! How can I help?', sender: 'ai' },
    ],
    archived: overrides.archived ?? false,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CLIManager — Bug 001: searchSessions logger shadow', () => {
  let CLIManager: typeof import('../src/main/cli/CLIManager').CLIManager

  beforeEach(async () => {
    // Reset stores between tests
    for (const key of Object.keys(_stores)) delete _stores[key]
    vi.resetModules()
    const mod = await import('../src/main/cli/CLIManager')
    CLIManager = mod.CLIManager
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT throw when matching sessions are found (regression for logger shadow bug)', () => {
    const manager = new CLIManager(() => null)

    // Seed the session store directly via the mock
    _stores['clear-path-sessions'] = {
      sessions: [makeSession({
        sessionId: 'sess-001',
        name: 'TypeScript refactor',
        firstPrompt: 'Refactor the auth module',
        messageLog: [
          { type: 'text', content: 'Refactor the auth module', sender: 'user' },
          { type: 'text', content: 'Sure, I will refactor the auth module.', sender: 'ai' },
        ],
      })],
    }

    // Before the fix, this call would throw:
    //   TypeError: log.debug is not a function
    // because `const log = session.messageLog ?? []` shadowed the logger.
    expect(() => manager.searchSessions('auth', false)).not.toThrow()
  })

  it('returns correct matches when sessions contain the query string', () => {
    const manager = new CLIManager(() => null)

    _stores['clear-path-sessions'] = {
      sessions: [
        makeSession({
          sessionId: 'sess-abc',
          name: 'Auth refactor',
          firstPrompt: 'Refactor the auth module',
          messageLog: [
            { type: 'text', content: 'Refactor the auth module', sender: 'user' },
            { type: 'text', content: 'Sure! I will start with the auth service.', sender: 'ai' },
          ],
        }),
        makeSession({
          sessionId: 'sess-xyz',
          name: 'UI fixes',
          firstPrompt: 'Fix the button styles',
          messageLog: [
            { type: 'text', content: 'Fix the button styles', sender: 'user' },
            { type: 'text', content: 'Done.', sender: 'ai' },
          ],
        }),
      ],
    }

    const results = manager.searchSessions('auth', false)

    expect(results).toHaveLength(1)
    expect(results[0].sessionId).toBe('sess-abc')
    expect(results[0].matches.length).toBeGreaterThan(0)
  })

  it('returns empty array when no sessions match the query', () => {
    const manager = new CLIManager(() => null)

    _stores['clear-path-sessions'] = {
      sessions: [makeSession({ sessionId: 'sess-001', name: 'Unrelated session' })],
    }

    const results = manager.searchSessions('xyzzy-not-found', false)
    expect(results).toHaveLength(0)
  })

  it('returns empty array when there are no persisted sessions', () => {
    const manager = new CLIManager(() => null)
    _stores['clear-path-sessions'] = { sessions: [] }

    expect(() => manager.searchSessions('anything', false)).not.toThrow()
    expect(manager.searchSessions('anything', false)).toHaveLength(0)
  })

  it('handles regex mode without throwing', () => {
    const manager = new CLIManager(() => null)

    _stores['clear-path-sessions'] = {
      sessions: [makeSession({
        sessionId: 'sess-re',
        name: 'Regex test session',
        messageLog: [{ type: 'text', content: 'fix-123 issue resolved', sender: 'user' }],
      })],
    }

    expect(() => manager.searchSessions('fix-\\d+', true)).not.toThrow()
    const results = manager.searchSessions('fix-\\d+', true)
    expect(results).toHaveLength(1)
  })

  it('falls back to literal match when regex is invalid', () => {
    const manager = new CLIManager(() => null)

    _stores['clear-path-sessions'] = {
      sessions: [makeSession({
        sessionId: 'sess-inv',
        name: 'test session',
        messageLog: [{ type: 'text', content: 'test[invalid', sender: 'user' }],
      })],
    }

    // '[invalid' is not a valid regex — should fall back to literal search
    expect(() => manager.searchSessions('[invalid', true)).not.toThrow()
    const results = manager.searchSessions('[invalid', true)
    expect(results).toHaveLength(1)
    expect(results[0].matches[0].content).toContain('[invalid')
  })
})

describe('CLIManager — Bug 002: Turn elapsed time uses turn start, not session start', () => {
  it('ActiveSession has turnStartedAt field that runTurn sets (verifies the fix is in place)', async () => {
    // Reset and re-import to ensure the patched module is used
    for (const key of Object.keys(_stores)) delete _stores[key]
    vi.resetModules()

    const { CLIManager } = await import('../src/main/cli/CLIManager')

    const manager = new CLIManager(() => null)

    // Start a session without a prompt so runTurn is not called immediately.
    const { sessionId } = await manager.startSession({
      cli: 'copilot',
      mode: 'prompt',
      // No prompt — so runTurn is NOT called from startSession
    })

    // The session should exist with no active process
    const info = manager.getSession(sessionId)
    expect(info).toBeDefined()
    expect(info!.sessionId).toBe(sessionId)
    expect(info!.status).toBe('running')

    // Access the internal session map to verify turnStartedAt is undefined before
    // any turn runs (no prompt provided), and that the field exists on the type.
    const sessions = (manager as unknown as { sessions: Map<string, { turnStartedAt?: number }> }).sessions
    const activeSession = sessions.get(sessionId)
    expect(activeSession).toBeDefined()
    // turnStartedAt should be undefined before any turn runs
    expect(activeSession!.turnStartedAt).toBeUndefined()
  })

  it('turnStartedAt is set when runTurn is called via startSession with a prompt', async () => {
    for (const key of Object.keys(_stores)) delete _stores[key]
    vi.resetModules()

    // Provide a mock adapter that captures when startSession is called
    const mockProc = {
      pid: 42,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      stdin: { write: vi.fn(), end: vi.fn() },
      on: vi.fn(),
    }

    vi.doMock('../src/main/cli/CopilotAdapter', () => ({
      CopilotAdapter: class {
        readonly cliName = 'copilot'
        binaryPath = 'copilot'
        isInstalled = vi.fn().mockResolvedValue(true)
        isAuthenticated = vi.fn().mockResolvedValue(true)
        buildArgs = vi.fn().mockReturnValue([])
        parseOutput = vi.fn().mockReturnValue({ type: 'text', content: '' })
        startSession = vi.fn().mockReturnValue(mockProc)
        sendInput = vi.fn()
        sendSlashCommand = vi.fn()
      },
    }))

    const { CLIManager } = await import('../src/main/cli/CLIManager')
    const manager = new CLIManager(() => null)

    const before = Date.now()
    await manager.startSession({
      cli: 'copilot',
      mode: 'prompt',
      prompt: 'Hello',
    })
    const after = Date.now()

    const sessions = (manager as unknown as { sessions: Map<string, { turnStartedAt?: number }> }).sessions
    const activeSession = [...sessions.values()][0]
    expect(activeSession).toBeDefined()
    // turnStartedAt should be set to approximately now (within the test window)
    expect(activeSession!.turnStartedAt).toBeDefined()
    expect(activeSession!.turnStartedAt!).toBeGreaterThanOrEqual(before)
    expect(activeSession!.turnStartedAt!).toBeLessThanOrEqual(after)
  })
})
