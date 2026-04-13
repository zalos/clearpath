/**
 * Comprehensive IPC mock helper for renderer component/page tests.
 *
 * Many renderer files are pre-loaded by setup-coverage.ts which uses
 * import.meta.glob with eager: false. This means vi.mock() calls in
 * individual test files may not intercept the cached module, so
 * components will attempt real IPC calls. This helper provides safe
 * default responses for ALL known IPC channels.
 */

import type { Mock } from 'vitest'

/**
 * Default mock responses for all known IPC channels.
 * Returns safe empty/zero values that won't cause null-access crashes.
 */
const DEFAULT_IPC_RESPONSES: Record<string, unknown> = {
  // Settings
  'settings:get': {
    activeCli: 'copilot',
    model: 'claude-sonnet-4-5',
    permissionMode: 'default',
    experimental: false,
    allowedTools: [],
    excludedTools: [],
    flags: {},
    mcpConfig: '',
    budget: { daily: 0, weekly: 0, monthly: 0 },
    profiles: [],
    plugins: [],
    envVars: {},
  },
  'settings:update-flag': null,
  'settings:reset-flag': null,
  'settings:reset-all': null,
  'settings:save-profile': { success: true },
  'settings:load-profile': { success: true },
  'settings:delete-profile': { success: true },
  'settings:list-profiles': [],
  'settings:export': { success: true },
  'settings:import': { success: true },
  'settings:get-env-vars': {},
  'settings:set-env-var': null,

  // Auth
  'auth:get-status': { copilot: false, claude: false },
  'auth:refresh': { copilot: false, claude: false },
  'auth:login-start': null,

  // CLI
  'cli:check-installed': { copilot: true, claude: false },
  'cli:list-sessions': [],
  'cli:get-persisted-sessions': [],
  'cli:start-session': { sessionId: 'test-session', status: 'active' },
  'cli:stop-session': null,
  'cli:send-input': null,

  // Policy
  'policy:get-active': { presetName: 'Standard' },
  'policy:list': [],
  'policy:get': null,

  // Workspace
  'workspace:list': [],
  'workspace:get-active': null,
  'workspace:set-active': null,

  // Learn
  'learn:get-progress': { percentage: 0, dismissed: false },
  'learn:get-paths': [],
  'learn:get-achievements': [],
  'learn:complete-lesson': null,
  'learn:dismiss': null,

  // Cost
  'cost:summary': { total: 0, daily: 0, weekly: 0, monthly: 0 },
  'cost:daily-spend': [],
  'cost:by-session': [],
  'cost:by-model': [],
  'cost:by-agent': [],
  'cost:budget-config': { daily: 0, weekly: 0, monthly: 0, autoPause: false, alerts: [] },
  'cost:set-budget-config': null,
  'cost:set-display-mode': null,

  // Agent
  'agent:list': { copilot: [], claude: [] },
  'agent:get': null,
  'agent:create': { success: true },
  'agent:delete': { success: true },
  'agent:toggle': null,

  // Notifications
  'notifications:list': [],
  'notifications:unread-count': 0,
  'notifications:dismiss': null,
  'notifications:get-prefs': { email: false, desktop: true, perType: {} },
  'notifications:set-prefs': null,
  'notifications:webhooks': [],
  'notifications:save-webhook': { success: true },
  'notifications:delete-webhook': { success: true },

  // Templates
  'templates:list': [],
  'templates:save': { success: true },
  'templates:delete': { success: true },
  'templates:export': { success: true },
  'templates:import': { success: true },

  // Skills
  'skills:list': [],
  'skills:save': { success: true },
  'skills:toggle': null,
  'skills:delete': null,
  'skills:export': { success: true },
  'skills:import': { success: true },

  // Sub-agent
  'subagent:list': [],
  'subagent:spawn': { id: 'sa-1', name: 'test' },
  'subagent:kill': null,
  'subagent:pause': null,
  'subagent:resume': null,
  'subagent:pop-out': null,
  'subagent:kill-all': null,
  'subagent:fleet-status': { agents: [] },
  'subagent:check-queue-installed': { installed: false },
  'subagent:get-output': [],

  // Knowledge Base
  'kb:list-files': [],
  'kb:get-sections': [],
  'kb:search': [],
  'kb:generate': null,
  'kb:update': null,
  'kb:ask': null,
  'kb:export-file': { path: '/tmp/export.md' },

  // Scheduler
  'scheduler:list': [],
  'scheduler:save': { success: true },
  'scheduler:toggle': null,
  'scheduler:run-now': null,
  'scheduler:delete': null,
  'scheduler:templates': [],

  // Compliance
  'compliance:get-log': [],
  'compliance:security-events': [],
  'compliance:get-file-patterns': [],
  'compliance:export-snapshot': { path: '/tmp/snapshot.json' },
  'compliance:set-file-patterns': null,
  'compliance:recent-events': [],

  // Git
  'git:status': { branch: 'main', files: [], ahead: 0, behind: 0 },
  'git:worktrees': [],
  'git:branch-protection': { protected: [] },
  'git:create-worktree': '/tmp/worktree',
  'git:remove-worktree': null,

  // File Explorer
  'files:list': [],
  'files:watch': null,
  'files:read': '',
  'files:write': null,

  // Onboarding
  'onboarding:get-state': {
    completed: false,
    trainingModeEnabled: false,
    steps: {},
    completedTasks: [],
  },
  'onboarding:complete': null,
  'onboarding:set-training-mode': { trainingModeEnabled: false },
  'onboarding:complete-guided-task': null,

  // Dashboard
  'dashboard:get-active-layout': {
    id: 'default',
    name: 'Default',
    widgets: [],
    layout: [],
  },
  'dashboard:list-layouts': [],
  'dashboard:set-active': null,
  'dashboard:save-layout': null,

  // Integration
  'integration:get-status': { github: null },
  'integration:github-connect': { success: true, username: 'test' },
  'integration:github-disconnect': null,
  'integration:github-repos': { success: true, repos: [] },
  'integration:github-pulls': { success: true, pulls: [] },
  'integration:github-issues': { success: true, issues: [] },

  // Team
  'team:list-bundles': [],
  'team:export-bundle': { success: true },
  'team:import-bundle': { success: true },
  'team:shared-folders': [],
  'team:marketplace-agents': [],
  'team:list-marketplace': [],
  'team:activity': [],

  // Memory / Notes
  'notes:list': [],
  'notes:create': { success: true },
  'notes:update': { success: true },
  'notes:delete': { success: true },
  'memory:list': [],

  // App
  'app:get-cwd': '/tmp/test-project',
  'app:get-version': '1.0.0',

  // Starter pack
  'starter-pack:get-skills': [],
  'starter-pack:get-agents': [],
  'starter-pack:get-agent': null,
  'starter-pack:get-skill': null,
  'starter-pack:get-suggestions': [],

  // PR Scores
  'pr-scores:get-config': { enabled: false, model: 'sonnet', criteria: [] },
  'pr-scores:get-scores': [],
  'pr-scores:score-pr': { success: true },
  'pr-scores:score-all': { success: true },
  'pr-scores:calculate-metrics': { success: true },
  'pr-scores:set-config': null,
  'pr-scores:build-ai-context': null,

  // Updater
  'updater:install': null,
  'updater:check': null,

  // Setup wizard
  'setup-wizard:get-state': {
    currentStep: 0,
    completed: false,
    steps: {},
  },
  'setup-wizard:update-step': { currentStep: 0, completed: false, steps: {} },

  // Navigate
  'navigate:configure-integrations': null,

  // Plugins
  'plugins:list': [],
  'plugins:install': { success: true },
  'plugins:remove': { success: true },

  // Data management
  'data:export-all': { path: '/tmp/export.json' },
  'data:import-all': { success: true },
  'data:clear-all': { success: true },
  'data:get-size': { total: 0, breakdown: {} },

  // Wizard
  'wizard:get-state': { completed: false, preferences: {} },
  'wizard:save-state': null,

  // Branding / White label
  'branding:get': { appName: 'ClearPathAI', logoPath: '', accentColor: '#4F46E5' },
  'branding:set': null,

  // Feature flags
  'feature-flags:get': {},
  'feature-flags:set': null,

  // Voice
  'voice:start-recording': null,
  'voice:stop-recording': { text: '' },
}

/**
 * Creates a mock electronAPI.invoke function that returns default responses
 * for all known channels. Individual test files can override specific channels
 * by calling mockInvoke.mockImplementation() after setup.
 */
export function createMockInvoke(overrides?: Record<string, unknown>): Mock {
  const responses = { ...DEFAULT_IPC_RESPONSES, ...overrides }

  const mockInvoke = vi.fn().mockImplementation((channel: string) => {
    if (channel in responses) {
      return Promise.resolve(responses[channel])
    }
    return Promise.resolve(null)
  })

  return mockInvoke
}

/**
 * Sets up window.electronAPI with comprehensive mocks.
 * Call this in beforeEach() of your test file.
 *
 * Returns { mockInvoke, mockOn } for additional assertions.
 */
export function setupElectronAPI(overrides?: Record<string, unknown>) {
  const mockInvoke = createMockInvoke(overrides)
  const mockOn = vi.fn(() => vi.fn())

  Object.defineProperty(window, 'electronAPI', {
    value: { invoke: mockInvoke, on: mockOn, off: vi.fn() },
    writable: true,
    configurable: true,
  })

  return { mockInvoke, mockOn }
}
