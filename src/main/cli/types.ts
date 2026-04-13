import type { ChildProcess } from 'child_process'
import type { SessionOptions, ParsedOutput, SessionInfo } from '../../renderer/src/types/ipc'

export interface ICLIAdapter {
  readonly cliName: string
  binaryPath: string

  isInstalled(): Promise<boolean>
  isAuthenticated(): Promise<boolean>

  buildArgs(options: SessionOptions): string[]
  parseOutput(data: string): ParsedOutput

  startSession(options: SessionOptions): ChildProcess
  sendInput(proc: ChildProcess, input: string): void
  sendSlashCommand(proc: ChildProcess, command: string): void
}

export interface ActiveSession {
  info: SessionInfo
  /** The child process for the current in-flight turn. Null between turns. */
  process: ChildProcess | null
  adapter: ICLIAdapter
  /** Partial line buffer for the current turn's stdout. */
  buffer: string
  /** Original options used to start the session — re-used for each subsequent turn. */
  originalOptions: SessionOptions
  /** How many turns have been completed. Used to decide whether to pass --continue. */
  turnCount: number
  /** True while a process is running for the current turn. */
  processingTurn: boolean
  /** Bytes of output received in the current turn (for cost estimation). */
  turnOutputBytes: number
  /** The prompt text sent for the current turn. */
  lastPrompt: string
  /** Timestamp (ms) when the current turn was spawned — used for per-turn elapsed logging. */
  turnStartedAt?: number
  /** Full message history for this session (for rehydration when UI remounts). */
  messageLog: Array<{ type: string; content: string; metadata?: unknown; sender?: 'user' | 'ai' | 'system'; timestamp?: number }>
}

// ── Sub-agent / delegated task types ─────────────────────────────────────────

export type SubAgentStatus = 'running' | 'completed' | 'failed' | 'killed'

export interface SubAgentInfo {
  id: string
  name: string
  cli: 'copilot' | 'claude'
  status: SubAgentStatus
  prompt: string
  model?: string
  workingDirectory?: string
  permissionMode?: string
  startedAt: number
  endedAt?: number
  exitCode?: number
  pid?: number
}

export interface SubAgentProcess {
  info: SubAgentInfo
  process: import('child_process').ChildProcess | null
  adapter: ICLIAdapter
  buffer: string
  /** Accumulated output lines for this sub-agent. */
  outputLog: ParsedOutput[]
}

export type { SessionOptions, ParsedOutput, SessionInfo }
