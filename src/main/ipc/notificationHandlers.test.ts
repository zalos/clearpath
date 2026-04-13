import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// ── Mock rateLimiter ────────────────────────────────────────────────────────

import * as rateLimiter from '../utils/rateLimiter'

const mockCheckRateLimit = vi.spyOn(rateLimiter, 'checkRateLimit')

// ── Import and register ─────────────────────────────────────────────────────

import { registerNotificationHandlers } from './notificationHandlers'

// ── Mock NotificationManager ────────────────────────────────────────────────

function createMockManager() {
  return {
    emit: vi.fn().mockReturnValue({ id: 'notif-1', timestamp: Date.now() }),
    getAll: vi.fn().mockReturnValue([]),
    getUnreadCount: vi.fn().mockReturnValue(0),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismiss: vi.fn(),
    clearAll: vi.fn(),
    getPrefs: vi.fn().mockReturnValue({ inbox: {}, desktop: {}, webhook: {} }),
    setPrefs: vi.fn(),
    getWebhooks: vi.fn().mockReturnValue([]),
    saveWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    testWebhook: vi.fn().mockResolvedValue({ success: true }),
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type HandlerMap = Record<string, (...args: unknown[]) => unknown>

function extractHandlers(): HandlerMap {
  const handlers: HandlerMap = {}
  for (const call of (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls) {
    handlers[call[0] as string] = call[1] as (...args: unknown[]) => unknown
  }
  return handlers
}

const mockEvent = {} as Electron.IpcMainInvokeEvent

// ── Tests ───────────────────────────────────────────────────────────────────

describe('notificationHandlers', () => {
  let manager: ReturnType<typeof createMockManager>
  let handlers: HandlerMap

  beforeEach(() => {
    vi.clearAllMocks()
    ;(ipcMain.handle as ReturnType<typeof vi.fn>).mockClear()
    // Restore default mock implementation after clearAllMocks wipes it
    mockCheckRateLimit.mockImplementation(() => ({ allowed: true }))

    manager = createMockManager()
    registerNotificationHandlers(ipcMain as unknown as Electron.IpcMain, manager as any)
    handlers = extractHandlers()
  })

  it('registers all expected channels', () => {
    const channels = Object.keys(handlers)
    expect(channels).toContain('notifications:emit')
    expect(channels).toContain('notifications:list')
    expect(channels).toContain('notifications:unread-count')
    expect(channels).toContain('notifications:mark-read')
    expect(channels).toContain('notifications:mark-all-read')
    expect(channels).toContain('notifications:dismiss')
    expect(channels).toContain('notifications:clear-all')
    expect(channels).toContain('notifications:get-prefs')
    expect(channels).toContain('notifications:set-prefs')
    expect(channels).toContain('notifications:list-webhooks')
    expect(channels).toContain('notifications:save-webhook')
    expect(channels).toContain('notifications:delete-webhook')
    expect(channels).toContain('notifications:test-webhook')
  })

  // ── notifications:emit ──────────────────────────────────────────────────

  describe('notifications:emit', () => {
    it('delegates to manager.emit with args', () => {
      const args = {
        type: 'session-complete' as const,
        severity: 'info' as const,
        title: 'Done',
        message: 'Session ended',
        source: 'test',
      }
      handlers['notifications:emit'](mockEvent, args)
      expect(manager.emit).toHaveBeenCalledWith(args)
    })

    it('passes optional sessionId and action', () => {
      const args = {
        type: 'error' as const,
        severity: 'critical' as const,
        title: 'Error',
        message: 'Crash',
        source: 'test',
        sessionId: 'sess-1',
        action: { label: 'Retry', ipcChannel: 'cli:restart' },
      }
      handlers['notifications:emit'](mockEvent, args)
      expect(manager.emit).toHaveBeenCalledWith(args)
    })
  })

  // ── notifications:list ──────────────────────────────────────────────────

  describe('notifications:list', () => {
    it('delegates to manager.getAll with no args', () => {
      handlers['notifications:list'](mockEvent)
      expect(manager.getAll).toHaveBeenCalledWith(undefined)
    })

    it('passes filter args', () => {
      const args = { limit: 10, type: 'error', unreadOnly: true }
      handlers['notifications:list'](mockEvent, args)
      expect(manager.getAll).toHaveBeenCalledWith(args)
    })
  })

  // ── notifications:unread-count ──────────────────────────────────────────

  describe('notifications:unread-count', () => {
    it('returns unread count from manager', () => {
      manager.getUnreadCount.mockReturnValue(42)
      const result = handlers['notifications:unread-count'](mockEvent)
      expect(result).toBe(42)
    })
  })

  // ── notifications:mark-read ─────────────────────────────────────────────

  describe('notifications:mark-read', () => {
    it('calls manager.markRead and returns success', () => {
      const result = handlers['notifications:mark-read'](mockEvent, { id: 'notif-1' })
      expect(manager.markRead).toHaveBeenCalledWith('notif-1')
      expect(result).toEqual({ success: true })
    })
  })

  // ── notifications:mark-all-read ─────────────────────────────────────────

  describe('notifications:mark-all-read', () => {
    it('calls manager.markAllRead and returns success', () => {
      const result = handlers['notifications:mark-all-read'](mockEvent)
      expect(manager.markAllRead).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })
  })

  // ── notifications:dismiss ───────────────────────────────────────────────

  describe('notifications:dismiss', () => {
    it('calls manager.dismiss and returns success', () => {
      const result = handlers['notifications:dismiss'](mockEvent, { id: 'notif-2' })
      expect(manager.dismiss).toHaveBeenCalledWith('notif-2')
      expect(result).toEqual({ success: true })
    })
  })

  // ── notifications:clear-all ─────────────────────────────────────────────

  describe('notifications:clear-all', () => {
    it('calls manager.clearAll and returns success', () => {
      const result = handlers['notifications:clear-all'](mockEvent)
      expect(manager.clearAll).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })
  })

  // ── notifications:get-prefs ─────────────────────────────────────────────

  describe('notifications:get-prefs', () => {
    it('returns prefs from manager', () => {
      const prefs = { inbox: {}, desktop: {}, webhook: {}, quietHoursEnabled: false }
      manager.getPrefs.mockReturnValue(prefs)
      const result = handlers['notifications:get-prefs'](mockEvent)
      expect(result).toEqual(prefs)
    })
  })

  // ── notifications:set-prefs ─────────────────────────────────────────────

  describe('notifications:set-prefs', () => {
    it('passes prefs to manager and returns success', () => {
      const prefs = { inbox: {}, desktop: {}, webhook: {} }
      const result = handlers['notifications:set-prefs'](mockEvent, { prefs })
      expect(manager.setPrefs).toHaveBeenCalledWith(prefs)
      expect(result).toEqual({ success: true })
    })
  })

  // ── notifications:list-webhooks ─────────────────────────────────────────

  describe('notifications:list-webhooks', () => {
    it('returns webhooks from manager', () => {
      const webhooks = [{ id: '1', name: 'Slack', url: 'https://hooks.slack.com/x' }]
      manager.getWebhooks.mockReturnValue(webhooks)
      const result = handlers['notifications:list-webhooks'](mockEvent)
      expect(result).toEqual(webhooks)
    })
  })

  // ── notifications:save-webhook — URL validation ─────────────────────────

  describe('notifications:save-webhook', () => {
    it('saves a valid HTTPS webhook', () => {
      const args = { name: 'Slack', url: 'https://hooks.slack.com/services/abc', type: 'slack-webhook', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBeUndefined()
      expect(result.id).toBeDefined()
      expect(manager.saveWebhook).toHaveBeenCalled()
    })

    it('preserves provided id when given', () => {
      const args = { id: 'wh-existing', name: 'Slack', url: 'https://hooks.slack.com/x', type: 'slack-webhook', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.id).toBe('wh-existing')
    })

    it('rejects non-HTTPS URLs', () => {
      const args = { name: 'Bad', url: 'http://example.com/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Only HTTPS URLs are allowed for webhooks')
      expect(manager.saveWebhook).not.toHaveBeenCalled()
    })

    it('rejects localhost URLs', () => {
      const args = { name: 'Local', url: 'https://localhost/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Localhost URLs are not allowed')
    })

    it('rejects 127.0.0.1', () => {
      const args = { name: 'Loopback', url: 'https://127.0.0.1/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Localhost URLs are not allowed')
    })

    it('blocks IPv6 loopback [::1] — BUG-008/BUG-016 fixed: brackets stripped', () => {
      const args = { name: 'IPv6', url: 'https://[::1]/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Localhost URLs are not allowed')
      expect(manager.saveWebhook).not.toHaveBeenCalled()
    })

    it('rejects 10.x.x.x private IPs', () => {
      const args = { name: 'Private', url: 'https://10.0.0.1/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Private IP addresses are not allowed')
    })

    it('rejects 172.16.x.x private IPs', () => {
      const args = { name: 'Private', url: 'https://172.16.0.1/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Private IP addresses are not allowed')
    })

    it('rejects 192.168.x.x private IPs', () => {
      const args = { name: 'Private', url: 'https://192.168.1.1/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Private IP addresses are not allowed')
    })

    it('rejects 169.254.x.x link-local IPs', () => {
      const args = { name: 'LinkLocal', url: 'https://169.254.169.254/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Metadata service and link-local addresses are not allowed')
    })

    it('rejects invalid URLs', () => {
      const args = { name: 'Bad', url: 'not-a-url', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Invalid URL')
    })

    it('rejects empty URL — BUG-015 fixed: empty string returns error instead of saving', () => {
      const args = { name: 'Empty', url: '', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Webhook URL is required')
      expect(manager.saveWebhook).not.toHaveBeenCalled()
    })

    it('rejects whitespace-only URL', () => {
      const args = { name: 'Whitespace', url: '   ', type: 'generic-json', enabledTypes: [], enabled: true }
      const result = handlers['notifications:save-webhook'](mockEvent, args) as any
      expect(result.error).toBe('Webhook URL is required')
      expect(manager.saveWebhook).not.toHaveBeenCalled()
    })

    it('blocks IPv6 unique-local addresses — BUG-016 fixed via shared isWebhookUrlSafe', () => {
      const fdArgs = { name: 'IPv6fd', url: 'https://[fd00::1]/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      const fcArgs = { name: 'IPv6fc', url: 'https://[fc00::1]/hook', type: 'generic-json', enabledTypes: [], enabled: true }
      expect((handlers['notifications:save-webhook'](mockEvent, fdArgs) as any).error).toBeDefined()
      expect((handlers['notifications:save-webhook'](mockEvent, fcArgs) as any).error).toBeDefined()
    })
  })

  // ── notifications:delete-webhook ────────────────────────────────────────

  describe('notifications:delete-webhook', () => {
    it('calls manager.deleteWebhook and returns success', () => {
      const result = handlers['notifications:delete-webhook'](mockEvent, { id: 'wh-1' })
      expect(manager.deleteWebhook).toHaveBeenCalledWith('wh-1')
      expect(result).toEqual({ success: true })
    })
  })

  // ── notifications:test-webhook ──────────────────────────────────────────

  describe('notifications:test-webhook', () => {
    it('delegates to manager.testWebhook when rate limit allows', () => {
      handlers['notifications:test-webhook'](mockEvent, { id: 'wh-1' })
      expect(mockCheckRateLimit).toHaveBeenCalledWith('notifications:test-webhook')
      expect(manager.testWebhook).toHaveBeenCalledWith('wh-1')
    })

    it('returns rate limit error when throttled', () => {
      mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 5000 })
      const result = handlers['notifications:test-webhook'](mockEvent, { id: 'wh-1' }) as any
      expect(result.success).toBe(false)
      expect(result.error).toContain('Rate limited')
      expect(manager.testWebhook).not.toHaveBeenCalled()
    })

    it('correctly calculates retry seconds from ms', () => {
      mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 3500 })
      const result = handlers['notifications:test-webhook'](mockEvent, { id: 'wh-1' }) as any
      // Math.ceil(3500 / 1000) = 4
      expect(result.error).toContain('4s')
    })

    it('handles retryAfterMs of 0', () => {
      mockCheckRateLimit.mockReturnValueOnce({ allowed: false, retryAfterMs: 0 })
      const result = handlers['notifications:test-webhook'](mockEvent, { id: 'wh-1' }) as any
      expect(result.error).toContain('0s')
    })

    it('handles undefined retryAfterMs', () => {
      mockCheckRateLimit.mockReturnValueOnce({ allowed: false })
      const result = handlers['notifications:test-webhook'](mockEvent, { id: 'wh-1' }) as any
      // (undefined ?? 0) / 1000 = 0, Math.ceil(0) = 0
      expect(result.error).toContain('0s')
    })
  })
})
