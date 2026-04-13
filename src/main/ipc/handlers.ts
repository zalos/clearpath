import type { IpcMain } from 'electron'
import type { SessionOptions } from '../cli/types'
import type { CLIManager } from '../cli/CLIManager'
import type { AgentManager } from '../agents/AgentManager'
import { checkRateLimit } from '../utils/rateLimiter'
import { STARTER_AGENTS } from '../starter-pack/agents'
import Store from 'electron-store'
import { getStoreEncryptionKey } from '../utils/storeEncryption'
import { existsSync, readFileSync } from 'fs'

export function registerIpcHandlers(
  ipcMain: IpcMain,
  cliManager: CLIManager,
  agentManager?: AgentManager
): void {
  ipcMain.handle('cli:check-installed', () => cliManager.checkInstalled())

  ipcMain.handle('cli:check-auth', () => cliManager.checkAuth())

  ipcMain.handle('cli:start-session', (_event, options: SessionOptions) => {
    const rl = checkRateLimit('cli:start-session')
    if (!rl.allowed) return { error: `Rate limited — try again in ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)}s` }

    let resolved = options

    // Auto-inject the saved model from settings, or fall back to app defaults
    if (!resolved.model) {
      const DEFAULT_MODELS: Record<string, string> = { copilot: 'gpt-5-mini', claude: 'sonnet' }
      let modelToUse = DEFAULT_MODELS[options.cli] ?? ''
      try {
        const settingsStore = new Store({ name: 'clear-path-settings', encryptionKey: getStoreEncryptionKey() })
        const settings = settingsStore.get('settings') as { model?: { copilot?: string; claude?: string } } | undefined
        const savedModel = settings?.model?.[options.cli]
        if (savedModel) modelToUse = savedModel
      } catch { /* settings not available */ }
      if (modelToUse) resolved = { ...resolved, model: modelToUse }
    }

    // Resolve the agent — either from explicit option or from stored active agent
    let agentId = resolved.agent ?? null
    if (!agentId && agentManager) {
      const active = agentManager.getActiveAgents()
      agentId = active[options.cli] ?? null
    }

    if (agentId) {
      let agentResolved = false
      let agentSystemPrompt: string | null = null

      // 1. File-based agent — read the system prompt from the file
      if (agentId.includes(':file:') && agentManager) {
        const allAgents = agentManager.listAgents()
        const match = [...allAgents.copilot, ...allAgents.claude].find((a) => a.id === agentId)
        if (match?.filePath && existsSync(match.filePath)) {
          try {
            const content = readFileSync(match.filePath, 'utf8')
            const bodyMatch = /^---[\s\S]*?---\s*\n([\s\S]*)$/.exec(content)
            agentSystemPrompt = bodyMatch?.[1]?.trim() || null
          } catch { /* file unreadable */ }
        }

        if (!agentSystemPrompt) {
          // File missing or unreadable — fall back to starter pack match
          const slug = agentId.split(':file:').pop()!
          const starterMatch = STARTER_AGENTS.find(
            (a) => a.id === slug || a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slug
          )
          if (starterMatch) agentSystemPrompt = starterMatch.systemPrompt
        }

        if (agentSystemPrompt) agentResolved = true
      }

      // 2. Starter pack agent ID or name (not a file agent)
      if (!agentResolved) {
        const starterAgent = STARTER_AGENTS.find(
          (a) => a.id === agentId || a.name === agentId
        )
        if (starterAgent) {
          agentSystemPrompt = starterAgent.systemPrompt
          agentResolved = true
        }
      }

      // Inject agent prompt ONLY if the user actually provided a prompt.
      // If no user prompt, store the agent context for the first turn when the user types.
      if (agentResolved && agentSystemPrompt) {
        resolved = { ...resolved, agent: undefined }
        if (resolved.prompt?.trim()) {
          resolved = { ...resolved, prompt: `${agentSystemPrompt}\n\n${resolved.prompt}` }
        } else {
          // No user prompt — store as agentContext so it gets prepended on the first real input
          resolved = { ...resolved, prompt: undefined, agentContext: agentSystemPrompt }
        }
      } else if (!agentResolved) {
        // Unresolved — don't pass a bad --agent flag
        resolved = { ...resolved, agent: undefined }
      }
    }

    return cliManager.startSession(resolved)
  })

  ipcMain.handle(
    'cli:send-input',
    (_event, { sessionId, input }: { sessionId: string; input: string }) => {
      cliManager.sendInput(sessionId, input)
    }
  )

  ipcMain.handle(
    'cli:send-slash-command',
    (_event, { sessionId, command }: { sessionId: string; command: string }) => {
      cliManager.sendSlashCommand(sessionId, command)
    }
  )

  ipcMain.handle('cli:stop-session', (_event, { sessionId }: { sessionId: string }) =>
    cliManager.stopSession(sessionId)
  )

  ipcMain.handle('cli:list-sessions', () => cliManager.listSessions())

  ipcMain.handle('cli:get-session', (_event, { sessionId }: { sessionId: string }) =>
    cliManager.getSession(sessionId)
  )

  ipcMain.handle('cli:get-message-log', (_event, { sessionId }: { sessionId: string }) => {
    // Try in-memory first (active sessions), fall back to persisted store
    const inMemory = cliManager.getSessionMessageLog(sessionId)
    if (inMemory.length > 0) return inMemory
    return cliManager.getPersistedMessageLog(sessionId)
  })

  // Persisted session history (survives app restart)
  ipcMain.handle('cli:get-persisted-sessions', () =>
    cliManager.getPersistedSessions()
  )

  // Session management operations
  ipcMain.handle('cli:delete-session', (_event, { sessionId }: { sessionId: string }) =>
    cliManager.deletePersistedSession(sessionId)
  )

  ipcMain.handle('cli:delete-sessions', (_event, { sessionIds }: { sessionIds: string[] }) =>
    cliManager.deletePersistedSessions(sessionIds)
  )

  ipcMain.handle('cli:archive-session', (_event, { sessionId, archived }: { sessionId: string; archived: boolean }) =>
    cliManager.archivePersistedSession(sessionId, archived)
  )

  ipcMain.handle('cli:rename-session', (_event, { sessionId, name }: { sessionId: string; name: string }) =>
    cliManager.renamePersistedSession(sessionId, name)
  )

  ipcMain.handle('cli:search-sessions', (_event, { query, useRegex }: { query: string; useRegex?: boolean }) =>
    cliManager.searchSessions(query, useRegex ?? false)
  )

  ipcMain.handle('app:get-cwd', () => process.cwd())
}
