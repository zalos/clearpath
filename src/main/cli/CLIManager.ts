import { randomUUID, createHash } from 'crypto'
import { log } from '../utils/logger'
import { getStoreEncryptionKey } from '../utils/storeEncryption'
import type { WebContents } from 'electron'
import type { SessionOptions, SessionInfo } from './types'
import type { ActiveSession, SubAgentProcess, SubAgentInfo, SubAgentStatus } from './types'
import type { ChildProcess } from 'child_process'
import { CopilotAdapter } from './CopilotAdapter'
import { ClaudeCodeAdapter } from './ClaudeCodeAdapter'
import Store from 'electron-store'

export type NotifyCallback = (args: {
  type: string; severity: string; title: string; message: string; source: string; sessionId?: string
  action?: { label: string; ipcChannel?: string; navigate?: string; tab?: string; panel?: string; args?: Record<string, unknown> }
}) => void

export type AuditCallback = (entry: {
  actionType: 'session' | 'prompt' | 'tool-approval' | 'file-change' | 'config-change' | 'policy-violation' | 'security-warning'
  summary: string
  details: string
  sessionId?: string
}) => void

export type CostRecordCallback = (args: {
  sessionId: string; sessionName: string; cli: 'copilot' | 'claude'
  model: string; agent?: string; inputTokens: number; outputTokens: number
  totalTokens: number; estimatedCostUsd: number; promptCount: number; timestamp: number
}) => void

// Persistent stores for session data that survives app restart
interface MessageLogEntry {
  type: string
  content: string
  metadata?: unknown
  sender?: 'user' | 'ai' | 'system'
  timestamp?: number
}

interface PersistedSession {
  sessionId: string
  cli: 'copilot' | 'claude'
  name?: string
  firstPrompt?: string
  startedAt: number
  endedAt?: number
  archived?: boolean
  messageLog: MessageLogEntry[]
}

interface SessionStoreSchema {
  sessions: PersistedSession[]
}

const sessionStore = new Store<SessionStoreSchema>({
  name: 'clear-path-sessions',
  defaults: { sessions: [] },
  encryptionKey: getStoreEncryptionKey(),
})

const MAX_PERSISTED_SESSIONS = 50
const MAX_PERSISTED_MESSAGES = 500
/** Auto-purge sessions older than 30 days to minimize data exposure at rest. */
const SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export class CLIManager {
  private readonly sessions = new Map<string, ActiveSession>()
  private readonly subAgents = new Map<string, SubAgentProcess>()
  private readonly copilot = new CopilotAdapter()
  private readonly claude = new ClaudeCodeAdapter()

  private readonly getWebContents: () => WebContents | null
  private onNotify: NotifyCallback | null = null
  private onCostRecord: CostRecordCallback | null = null
  private onAudit: AuditCallback | null = null

  constructor(getWebContents: () => WebContents | null) {
    this.getWebContents = getWebContents
    // Auto-purge expired sessions on startup
    this.purgeExpiredSessions()
  }

  /** Remove persisted sessions older than the retention TTL. */
  private purgeExpiredSessions(): void {
    const cutoff = Date.now() - SESSION_RETENTION_MS
    const sessions = sessionStore.get('sessions')
    const before = sessions.length
    const kept = sessions.filter((s) => {
      const ts = s.endedAt ?? s.startedAt
      return ts >= cutoff
    })
    if (kept.length < before) {
      sessionStore.set('sessions', kept)
      log.info(`[CLIManager] Purged ${before - kept.length} expired sessions (older than 30 days)`)
    }
  }

  // ── Session persistence helpers ──────────────────────────────────────────

  /** Save a session's message log to persistent storage */
  private persistSession(sessionId: string, session: ActiveSession): void {
    const sessions = sessionStore.get('sessions')
    const entry: PersistedSession = {
      sessionId,
      cli: session.info.cli,
      name: session.info.name,
      firstPrompt: session.lastPrompt || undefined,
      startedAt: session.info.startedAt,
      endedAt: session.info.status === 'stopped' ? Date.now() : undefined,
      messageLog: session.messageLog.slice(-MAX_PERSISTED_MESSAGES),
    }
    const idx = sessions.findIndex((s) => s.sessionId === sessionId)
    if (idx >= 0) {
      sessions[idx] = entry
    } else {
      sessions.unshift(entry)
      if (sessions.length > MAX_PERSISTED_SESSIONS) sessions.splice(MAX_PERSISTED_SESSIONS)
    }
    sessionStore.set('sessions', sessions)
  }

  /** Get all persisted sessions (for history/restore) */
  getPersistedSessions(): PersistedSession[] {
    return sessionStore.get('sessions')
  }

  /** Get a single persisted session's message log */
  getPersistedMessageLog(sessionId: string): MessageLogEntry[] {
    const sessions = sessionStore.get('sessions')
    return sessions.find((s) => s.sessionId === sessionId)?.messageLog ?? []
  }

  /** Delete a persisted session permanently */
  deletePersistedSession(sessionId: string): void {
    const sessions = sessionStore.get('sessions').filter((s) => s.sessionId !== sessionId)
    sessionStore.set('sessions', sessions)
    // Also remove from in-memory map if present
    this.sessions.delete(sessionId)
  }

  /** Delete multiple sessions at once */
  deletePersistedSessions(sessionIds: string[]): void {
    const idSet = new Set(sessionIds)
    const sessions = sessionStore.get('sessions').filter((s) => !idSet.has(s.sessionId))
    sessionStore.set('sessions', sessions)
    for (const id of sessionIds) this.sessions.delete(id)
  }

  /** Toggle archive flag on a session */
  archivePersistedSession(sessionId: string, archived: boolean): void {
    const sessions = sessionStore.get('sessions')
    const idx = sessions.findIndex((s) => s.sessionId === sessionId)
    if (idx >= 0) {
      sessions[idx] = { ...sessions[idx], archived }
      sessionStore.set('sessions', sessions)
    }
  }

  /** Rename a persisted session */
  renamePersistedSession(sessionId: string, name: string): void {
    const sessions = sessionStore.get('sessions')
    const idx = sessions.findIndex((s) => s.sessionId === sessionId)
    if (idx >= 0) {
      sessions[idx] = { ...sessions[idx], name }
      sessionStore.set('sessions', sessions)
    }
    // Also update in-memory if active
    const active = this.sessions.get(sessionId)
    if (active) active.info.name = name
  }

  /** Search across all session content using regex or plain text */
  searchSessions(query: string, useRegex: boolean): Array<{ sessionId: string; name?: string; cli: string; startedAt: number; archived?: boolean; matches: Array<{ content: string; sender?: string; lineIndex: number }> }> {
    const sessions = sessionStore.get('sessions')
    log.debug(`[CLIManager] searchSessions regex=${useRegex} sessionsCount=${sessions.length}`)
    let matcher: (text: string) => boolean
    try {
      matcher = useRegex
        ? ((re) => (text: string) => re.test(text))(new RegExp(query, 'gi'))
        : (text: string) => text.toLowerCase().includes(query.toLowerCase())
    } catch {
      // Invalid regex — fall back to literal match
      matcher = (text: string) => text.toLowerCase().includes(query.toLowerCase())
    }

    const results: Array<{ sessionId: string; name?: string; cli: string; startedAt: number; archived?: boolean; matches: Array<{ content: string; sender?: string; lineIndex: number }> }> = []

    for (const session of sessions) {
      const matches: Array<{ content: string; sender?: string; lineIndex: number }> = []

      // Search session name and first prompt as well
      if (session.name && matcher(session.name)) {
        matches.push({ content: `Session: ${session.name}`, sender: 'system', lineIndex: -1 })
      }
      if (session.firstPrompt && matcher(session.firstPrompt)) {
        matches.push({ content: session.firstPrompt.slice(0, 200), sender: 'user', lineIndex: -1 })
      }

      // Search message content
      const messages = session.messageLog ?? []
      for (let i = 0; i < messages.length; i++) {
        const entry = messages[i]
        if (entry.content && matcher(entry.content)) {
          matches.push({ content: entry.content.slice(0, 200), sender: entry.sender, lineIndex: i })
        }
      }
      if (matches.length > 0) {
        results.push({
          sessionId: session.sessionId,
          name: session.name,
          cli: session.cli,
          startedAt: session.startedAt,
          archived: session.archived,
          matches: matches.slice(0, 10),
        })
      }
    }
    log.debug(`[CLIManager] searchSessions found ${results.length} sessions with matches`)
    return results
  }

  /** Register a callback for slice-level notification emissions. */
  setNotifyCallback(cb: NotifyCallback): void {
    this.onNotify = cb
  }

  /** Register a callback for cost recording on each completed turn. */
  setCostRecordCallback(cb: CostRecordCallback): void {
    this.onCostRecord = cb
  }

  /** Register a callback for audit logging. */
  setAuditCallback(cb: AuditCallback): void {
    this.onAudit = cb
  }

  /** Log a prompt to the audit trail (hashed, not plaintext). */
  private auditPrompt(sessionId: string, cli: string, input: string): void {
    if (!this.onAudit) return
    const hash = createHash('sha256').update(input).digest('hex').slice(0, 16)
    this.onAudit({
      actionType: 'prompt',
      summary: `Prompt sent to ${cli} (${input.length} chars)`,
      details: JSON.stringify({ cli, charCount: input.length, promptHash: hash }),
      sessionId,
    })
  }

  /** Log a session lifecycle event to the audit trail. */
  private auditSession(sessionId: string, action: string, cli: string, details?: Record<string, unknown>): void {
    if (!this.onAudit) return
    this.onAudit({
      actionType: 'session',
      summary: `Session ${action}: ${cli}`,
      details: JSON.stringify({ cli, action, ...details }),
      sessionId,
    })
  }

  /** Estimate tokens from output byte count (rough: 1 token ≈ 4 chars). */
  private estimateCostFromOutput(
    sessionId: string, session: ActiveSession, outputBytes: number, inputPrompt?: string
  ): void {
    if (!this.onCostRecord) return
    const inputChars = inputPrompt?.length ?? 50
    const inputTokens = Math.ceil(inputChars / 4)
    const outputTokens = Math.ceil(outputBytes / 4)
    const totalTokens = inputTokens + outputTokens
    const model = session.originalOptions.model ?? (session.info.cli === 'copilot' ? 'gpt-5-mini' : 'sonnet')

    // Rough pricing per 1M tokens (input, output)
    const pricing: Record<string, [number, number]> = {
      // Free Copilot models (cost tracked at $0 since included in plan)
      'gpt-5-mini': [0.4, 1.6], 'gpt-4.1': [2, 8], 'gpt-4o': [2.5, 10],
      // Anthropic
      'claude-sonnet-4.5': [3, 15], 'claude-sonnet-4.6': [3, 15], 'claude-sonnet-4': [3, 15],
      'claude-haiku-4.5': [1, 5], 'sonnet': [3, 15], 'haiku': [1, 5],
      'claude-opus-4.5': [5, 25], 'claude-opus-4.6': [5, 25], 'opus': [5, 25],
      // OpenAI
      'gpt-5': [5, 15], 'gpt-5.1': [5, 15], 'gpt-5.1-codex': [5, 15],
      'gpt-5.3-codex': [5, 15], 'gpt-5.4-mini': [0.4, 1.6],
      // Google
      'gemini-2.5-pro': [3.5, 10.5], 'gemini-3-pro': [3.5, 10.5], 'gemini-3-flash': [0.5, 1.5],
    }
    const [inPrice, outPrice] = pricing[model] ?? [3, 15]
    const cost = (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000

    this.onCostRecord({
      sessionId,
      sessionName: session.info.name ?? sessionId.slice(0, 8),
      cli: session.info.cli,
      model,
      agent: session.originalOptions.agent,
      inputTokens, outputTokens, totalTokens,
      estimatedCostUsd: cost,
      promptCount: 1,
      timestamp: Date.now(),
    })
  }

  async checkInstalled(): Promise<{ copilot: boolean; claude: boolean }> {
    const [copilot, claude] = await Promise.all([
      this.copilot.isInstalled(),
      this.claude.isInstalled(),
    ])
    return { copilot, claude }
  }

  async checkAuth(): Promise<{ copilot: boolean; claude: boolean }> {
    const [copilot, claude] = await Promise.all([
      this.copilot.isAuthenticated(),
      this.claude.isAuthenticated(),
    ])
    return { copilot, claude }
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  async startSession(options: SessionOptions): Promise<{ sessionId: string }> {
    const adapter = options.cli === 'copilot' ? this.copilot : this.claude
    const sessionId = randomUUID()

    // Ensure adapter binary is resolved
    await adapter.isInstalled()

    log.info(`[CLIManager] startSession cli=${options.cli} sessionId=${sessionId.slice(0, 8)}`)

    const session: ActiveSession = {
      info: {
        sessionId,
        name: options.name,
        cli: options.cli,
        status: 'running',
        startedAt: Date.now(),
      },
      process: null,
      adapter,
      buffer: '',
      originalOptions: options,
      turnCount: 0,
      processingTurn: false,
      turnOutputBytes: 0,
      lastPrompt: options.displayPrompt?.trim() || options.prompt || '',
      messageLog: [],
    }

    // If context was injected (displayPrompt differs from prompt), log a status
    // summary so rehydrated sessions show what context was used, not raw prompt text.
    if (options.prompt?.trim() && options.displayPrompt?.trim() && options.displayPrompt !== options.prompt) {
      session.messageLog.push({ type: 'status', content: 'Session launched with context attached', sender: 'system', timestamp: Date.now() })
    }

    // Log the user's actual message (displayPrompt) — not the full injected prompt
    if (options.prompt?.trim()) {
      const logContent = options.displayPrompt?.trim() || options.prompt
      session.messageLog.push({ type: 'text', content: logContent, sender: 'user', timestamp: Date.now() })
    }

    this.sessions.set(sessionId, session)

    // Audit: session started
    this.auditSession(sessionId, 'started', options.cli, {
      model: options.model, agent: options.agent, permissionMode: options.permissionMode,
    })

    // Persist session creation immediately
    this.persistSession(sessionId, session)

    // If an initial prompt was given, run the first turn immediately
    // Send the FULL prompt (with agent context) to the CLI, not the display version
    if (options.prompt?.trim()) {
      this.runTurn(sessionId, options.prompt.trim())
    }

    return { sessionId }
  }

  sendInput(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.info.status !== 'running') return

    if (session.processingTurn) {
      log.debug(`[CLIManager] turn in progress — ignoring input (${input.length} chars)`)
      return
    }

    // Log user input to message history
    if (input !== 'y' && input !== 'n' && !input.startsWith('\x1b')) {
      session.messageLog.push({ type: 'text', content: input, sender: 'user', timestamp: Date.now() })
    }

    // If there's a deferred agent context (session started without a prompt),
    // prepend it to the first real user input so the AI gets the agent instructions.
    let actualInput = input
    if (session.originalOptions.agentContext && session.turnCount === 0) {
      actualInput = `${session.originalOptions.agentContext}\n\n${input}`
      // Clear it so it's not re-injected on subsequent turns
      session.originalOptions = { ...session.originalOptions, agentContext: undefined }
    }

    this.runTurn(sessionId, actualInput)
  }

  sendSlashCommand(sessionId: string, command: string): void {
    // Slash commands go through the same turn mechanism
    this.sendInput(sessionId, command)
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.process) {
      session.process.kill('SIGTERM')
      session.process = null
    }
    session.info.status = 'stopped'
    session.processingTurn = false

    // Audit: session stopped
    this.auditSession(sessionId, 'stopped', session.info.cli, { turnCount: session.turnCount })

    // Persist final state with endedAt timestamp
    this.persistSession(sessionId, session)
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s.info }))
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)?.info
  }

  getSessionMessageLog(sessionId: string): Array<{ type: string; content: string; metadata?: unknown }> {
    return this.sessions.get(sessionId)?.messageLog ?? []
  }

  // ── Per-turn spawning ─────────────────────────────────────────────────────

  /**
   * Spawns a headless (one-shot) process for a single turn of the conversation.
   * Both CLIs have purpose-built headless modes that output cleanly to stdout
   * over a plain pipe:
   *   - Claude Code: --print  (exits after responding)
   *   - Copilot CLI: --prompt (exits after responding)
   *
   * Conversation continuity is handled by the CLI itself via --continue, which
   * resumes the most-recently-closed session in the working directory.
   */
  private runTurn(sessionId: string, input: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.info.status !== 'running') return

    const turnOptions: SessionOptions = {
      ...session.originalOptions,
      // Force headless mode so the CLI writes plain text to stdout
      mode: 'prompt',
      prompt: input,
      // After the first turn, always continue the session the CLI just created
      continue: session.turnCount > 0 ? true : session.originalOptions.continue,
      // Don't re-resume a named session on turn 2+ — let --continue handle it
      resume: session.turnCount === 0 ? session.originalOptions.resume : undefined,
    }

    // Log turn start — do NOT log prompt content or full args in production
    log.info(`[CLIManager] runTurn #${session.turnCount} cli=${session.info.cli} inputLen=${input.length}`)
    log.debug(`[CLIManager] args:`, session.adapter.buildArgs(turnOptions))

    // Audit: prompt sent
    this.auditPrompt(sessionId, session.info.cli, input)

    const proc = session.adapter.startSession(turnOptions)
    session.process = proc
    session.buffer = ''
    session.processingTurn = true
    session.turnOutputBytes = 0
    session.lastPrompt = input
    session.turnStartedAt = Date.now()

    log.info(`[CLIManager] spawned pid=${proc.pid ?? 'unknown'} for session ${sessionId.slice(0, 8)}`)
    log.debug(`[CLIManager] turn #${session.turnCount} started — waiting for CLI response...`)

    // Notify renderer a turn started
    const wc0 = this.getWebContents()
    if (wc0 && !wc0.isDestroyed()) {
      wc0.send('cli:turn-start', { sessionId })
    }

    this.attachListeners(sessionId, session, proc)
  }

  // ── Sub-agent / delegated task management ─────────────────────────────────

  async spawnSubAgent(options: {
    name: string
    cli: 'copilot' | 'claude'
    prompt: string
    model?: string
    workingDirectory?: string
    permissionMode?: string
    agent?: string
    allowedTools?: string[]
    maxBudget?: number
    maxTurns?: number
  }): Promise<SubAgentInfo> {
    const adapter = options.cli === 'copilot' ? this.copilot : this.claude
    await adapter.isInstalled()
    const id = randomUUID()

    const sessionOpts: SessionOptions = {
      cli: options.cli,
      mode: 'prompt',
      prompt: options.prompt,
      model: options.model,
      workingDirectory: options.workingDirectory,
      agent: options.agent,
      allowedTools: options.allowedTools,
      maxBudget: options.maxBudget,
      maxTurns: options.maxTurns,
    }

    if (options.cli === 'claude' && options.permissionMode) {
      sessionOpts.permissionMode = options.permissionMode as SessionOptions['permissionMode']
    }
    if (options.cli === 'copilot' && options.permissionMode === 'yolo') {
      sessionOpts.yolo = true
    }

    const proc = adapter.startSession(sessionOpts)

    const info: SubAgentInfo = {
      id,
      name: options.name,
      cli: options.cli,
      status: 'running',
      prompt: options.prompt,
      model: options.model,
      workingDirectory: options.workingDirectory,
      permissionMode: options.permissionMode,
      startedAt: Date.now(),
      pid: proc.pid,
    }

    const subAgent: SubAgentProcess = {
      info,
      process: proc,
      adapter,
      buffer: '',
      outputLog: [],
    }

    this.subAgents.set(id, subAgent)
    this.attachSubAgentListeners(id, subAgent, proc)

    // Notify renderer
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('subagent:spawned', info)
    }

    return info
  }

  private attachSubAgentListeners(id: string, subAgent: SubAgentProcess, proc: ChildProcess): void {
    proc.stdout?.on('data', (chunk: Buffer) => {
      const raw = chunk.toString()
      subAgent.buffer += raw
      const lines = subAgent.buffer.split(/\r\n|\r|\n/)
      subAgent.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        const parsed = subAgent.adapter.parseOutput(line)
        subAgent.outputLog.push(parsed)

        const wc = this.getWebContents()
        if (wc && !wc.isDestroyed()) {
          wc.send('subagent:output', { id, output: parsed })
        }
      }
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const raw = chunk.toString()
      const parsed = { type: 'error' as const, content: raw.trim() }
      subAgent.outputLog.push(parsed)

      const wc = this.getWebContents()
      if (wc && !wc.isDestroyed()) {
        wc.send('subagent:output', { id, output: parsed })
      }
    })

    proc.on('error', (err) => {
      this.updateSubAgentStatus(id, 'failed')
      const parsed = { type: 'error' as const, content: `Spawn error: ${err.message}` }
      subAgent.outputLog.push(parsed)
      subAgent.process = null
    })

    proc.on('exit', (code, signal) => {
      // Flush remaining buffer
      if (subAgent.buffer.trim()) {
        const parsed = subAgent.adapter.parseOutput(subAgent.buffer)
        subAgent.outputLog.push(parsed)
        subAgent.buffer = ''
      }

      subAgent.process = null
      subAgent.info.exitCode = code ?? undefined
      subAgent.info.endedAt = Date.now()

      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        this.updateSubAgentStatus(id, 'killed')
      } else if (code !== 0) {
        this.updateSubAgentStatus(id, 'failed')
      } else {
        this.updateSubAgentStatus(id, 'completed')
      }

      // Record cost for completed sub-agents
      if (this.onCostRecord && code === 0) {
        const outputBytes = subAgent.outputLog.reduce((sum, o) => sum + o.content.length, 0)
        const inputChars = subAgent.info.prompt.length
        const inputTokens = Math.ceil(inputChars / 4)
        const outputTokens = Math.ceil(outputBytes / 4)
        const model = subAgent.info.model ?? (subAgent.info.cli === 'copilot' ? 'claude-sonnet-4.5' : 'sonnet')
        const pricing: Record<string, [number, number]> = {
          'claude-sonnet-4.5': [3, 15], 'sonnet': [3, 15], 'opus': [15, 75],
          'haiku': [0.25, 1.25], 'gpt-5': [5, 15],
        }
        const [inP, outP] = pricing[model] ?? [3, 15]
        this.onCostRecord({
          sessionId: id, sessionName: subAgent.info.name,
          cli: subAgent.info.cli, model,
          agent: undefined, inputTokens, outputTokens,
          totalTokens: inputTokens + outputTokens,
          estimatedCostUsd: (inputTokens * inP + outputTokens * outP) / 1_000_000,
          promptCount: 1, timestamp: Date.now(),
        })
      }
    })
  }

  private updateSubAgentStatus(id: string, status: SubAgentStatus): void {
    const sa = this.subAgents.get(id)
    if (!sa) return
    sa.info.status = status
    if (!sa.info.endedAt && status !== 'running') {
      sa.info.endedAt = Date.now()
    }
    const wc = this.getWebContents()
    if (wc && !wc.isDestroyed()) {
      wc.send('subagent:status-changed', sa.info)
    }
    // Notify on completion or failure only — keep it clean, with deep links
    if (this.onNotify) {
      if (status === 'completed') {
        this.onNotify({
          type: 'session-complete', severity: 'info',
          title: `${sa.info.name} completed`,
          message: 'Task finished successfully.',
          source: 'sub-agent-monitor', sessionId: id,
          action: { label: 'View Output', ipcChannel: '', navigate: '/work', panel: 'subagents' },
        })
      } else if (status === 'failed') {
        this.onNotify({
          type: 'error', severity: 'warning',
          title: `${sa.info.name} failed`,
          message: 'Task did not complete. Check Sub-Agents panel for details.',
          source: 'sub-agent-monitor', sessionId: id,
          action: { label: 'View Details', ipcChannel: '', navigate: '/work', panel: 'subagents' },
        })
      }
    }
  }

  killSubAgent(id: string): boolean {
    const sa = this.subAgents.get(id)
    if (!sa || !sa.process) return false
    sa.process.kill('SIGTERM')
    return true
  }

  pauseSubAgent(id: string): boolean {
    const sa = this.subAgents.get(id)
    if (!sa || !sa.process) return false
    // Send Ctrl+C (SIGINT) to interrupt current operation
    sa.process.kill('SIGINT')
    return true
  }

  resumeSubAgent(id: string, followUpPrompt?: string): boolean {
    const sa = this.subAgents.get(id)
    if (!sa || !sa.process) return false
    const msg = followUpPrompt?.trim() || 'continue'
    sa.process.stdin?.write(msg + '\n')
    return true
  }

  killAllSubAgents(): number {
    let count = 0
    for (const [id, sa] of this.subAgents) {
      if (sa.process) {
        sa.process.kill('SIGTERM')
        count++
      }
    }
    return count
  }

  listSubAgents(): SubAgentInfo[] {
    return Array.from(this.subAgents.values()).map((sa) => ({ ...sa.info }))
  }

  getSubAgentOutput(id: string): import('./types').ParsedOutput[] {
    return this.subAgents.get(id)?.outputLog ?? []
  }

  // ── Session listeners (existing) ─────────────────────────────────────────

  private attachListeners(sessionId: string, session: ActiveSession, proc: ChildProcess): void {
    proc.stdout?.on('data', (chunk: Buffer) => {
      const raw = chunk.toString()
      // Only log byte count in production — never log AI output content
      log.debug(`[CLIManager:${session.info.cli}] stdout (${raw.length}b)`)

      session.turnOutputBytes += raw.length
      session.buffer += raw
      const lines = session.buffer.split(/\r\n|\r|\n/)
      session.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        const parsed = session.adapter.parseOutput(line)
        log.debug(`[CLIManager:${session.info.cli}] parsed: ${parsed.type} (${parsed.content.length} chars)`)

        const wc = this.getWebContents()
        if (!wc || wc.isDestroyed()) continue

        // Store in message log for rehydration (cap at 500 entries)
        if (parsed.content.trim()) {
          session.messageLog.push({ type: parsed.type, content: parsed.content, metadata: parsed.metadata, sender: 'ai', timestamp: Date.now() })
          if (session.messageLog.length > 500) session.messageLog.splice(0, session.messageLog.length - 500)
        }

        if (parsed.type === 'permission-request') {
          wc.send('cli:permission-request', { sessionId, request: parsed })
        } else {
          wc.send('cli:output', { sessionId, output: parsed })
        }
      }
    })

    // Track recent stderr messages for deduplication (avoids spam from repeated policy warnings)
    const recentStderr = new Set<string>()
    let stderrFlushTimer: ReturnType<typeof setTimeout> | null = null

    proc.stderr?.on('data', (chunk: Buffer) => {
      const raw = chunk.toString()
      log.debug(`[CLIManager:${session.info.cli}] stderr (${raw.length}b)`)
      const wc = this.getWebContents()
      if (!wc || wc.isDestroyed()) return

      const trimmed = raw.trim()
      if (!trimmed) return

      // Detect usage/stats output and send as usage event instead of error
      const isUsageStats = /total usage est|premium request|api time spent|session time|code changes|breakdown by ai model/i.test(trimmed)
      if (isUsageStats) {
        wc.send('cli:usage', { sessionId, usage: trimmed })
        return
      }

      // Detect agent-not-found errors — suppress and show a gentle status instead
      const isAgentError = /no (?:such )?agent|agent.*not found|cannot find agent|unknown agent/i.test(trimmed)
      if (isAgentError) {
        log.warn(`[CLIManager:${session.info.cli}] agent error suppressed: ${trimmed.slice(0, 100)}`)
        wc.send('cli:output', { sessionId, output: { type: 'status', content: 'Agent not found — running without agent. You can re-create it from the Agents page.' } })
        session.messageLog.push({ type: 'status', content: 'Agent not found — running without agent.', sender: 'system', timestamp: Date.now() })
        return
      }

      // Detect organization policy / MCP warnings — show as status, not error
      const isPolicyWarning = /(?:mcp\s+server|organization.*policy|disabled\s+by|third[- ]party|only\s+built[- ]in)/i.test(trimmed)

      // Deduplicate repeated messages — suppress exact duplicates within a rolling window
      const dedupeKey = trimmed.slice(0, 200)
      if (recentStderr.has(dedupeKey)) {
        log.debug(`[CLIManager:${session.info.cli}] suppressed duplicate stderr`)
        return
      }
      recentStderr.add(dedupeKey)

      // Clear the dedup set periodically so genuinely new messages come through
      if (stderrFlushTimer) clearTimeout(stderrFlushTimer)
      stderrFlushTimer = setTimeout(() => recentStderr.clear(), 30_000)

      if (isPolicyWarning) {
        // Send as a status message (grey pill) instead of a red error block
        wc.send('cli:output', { sessionId, output: { type: 'status', content: trimmed, metadata: { source: 'policy' } } })
        session.messageLog.push({ type: 'status', content: trimmed, metadata: { source: 'policy' }, sender: 'system', timestamp: Date.now() })
      } else {
        wc.send('cli:error', { sessionId, error: trimmed })
      }
    })

    proc.on('error', (err) => {
      log.error(`[CLIManager:${session.info.cli}] spawn error:`, err.message)
      session.processingTurn = false
      session.process = null
      const wc = this.getWebContents()
      if (!wc || wc.isDestroyed()) return
      wc.send('cli:error', { sessionId, error: `Failed to start process: ${err.message}` })
      wc.send('cli:turn-end', { sessionId })
    })

    proc.on('exit', (code, signal) => {
      const duration = Date.now() - (session.turnStartedAt ?? Date.now())
      log.info(`[CLIManager] turn complete — session=${sessionId.slice(0, 8)} cli=${session.info.cli} exit=${code} signal=${signal} outputBytes=${session.turnOutputBytes} elapsed=${Math.round(duration / 1000)}s`)

      // Flush any remaining buffer
      if (session.buffer.trim()) {
        const parsed = session.adapter.parseOutput(session.buffer)
        session.buffer = ''
        const wc = this.getWebContents()
        if (wc && !wc.isDestroyed()) {
          wc.send('cli:output', { sessionId, output: parsed })
        }
      }

      session.process = null
      session.processingTurn = false
      session.turnCount++

      const wc = this.getWebContents()
      if (!wc || wc.isDestroyed()) return

      if (code !== 0) {
        // Non-zero exit — send turn-end so the UI stops showing the processing
        // indicator, but keep the session alive so the user can retry.
        // The stderr handler already showed any error messages to the user.
        wc.send('cli:turn-end', { sessionId })

        // Only notify on first-turn failures (likely auth/install issues)
        if (session.turnCount === 1) {
          this.onNotify?.({
            type: 'error', severity: 'warning',
            title: `Session issue`,
            message: `The ${session.info.cli === 'copilot' ? 'Copilot' : 'Claude'} process exited unexpectedly. You can try again from the session.`,
            source: 'cli-manager', sessionId,
            action: { label: 'View Session', navigate: '/work' },
          })
        }
      } else {
        // Turn completed normally — session stays open for next input
        wc.send('cli:turn-end', { sessionId })
        // Record cost for this completed turn
        this.estimateCostFromOutput(sessionId, session, session.turnOutputBytes, session.lastPrompt)
      }

      // Persist session data (message log + metadata) to disk after every turn
      this.persistSession(sessionId, session)
    })
  }
}
