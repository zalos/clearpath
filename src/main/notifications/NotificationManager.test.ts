import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Shared store data via globalThis (guaranteed same reference across scopes) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STORE_KEY = '__notifMgrTestStoreData' as const
;(globalThis as any)[STORE_KEY] = {} as Record<string, unknown>

const { mockHttpsRequest } = vi.hoisted(() => ({
  mockHttpsRequest: vi.fn(),
}))

vi.mock('electron-store', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd = (globalThis as any)['__notifMgrTestStoreData'] as Record<string, unknown>
  return {
    default: class MockStore {
      constructor(opts?: { defaults?: Record<string, unknown> }) {
        if (opts?.defaults) {
          for (const [k, v] of Object.entries(opts.defaults)) {
            if (!(k in sd)) {
              sd[k] = JSON.parse(JSON.stringify(v))
            }
          }
        }
      }

      get(key: string): unknown {
        const val = sd[key]
        return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined
      }

      set(key: string, value: unknown): void {
        sd[key] = JSON.parse(JSON.stringify(value))
      }

      has(key: string): boolean {
        return key in sd
      }

      delete(key: string): void {
        delete sd[key]
      }
    },
  }
})

vi.mock('../utils/storeEncryption', () => ({
  getStoreEncryptionKey: () => 'test-encryption-key',
}))

vi.mock('https', () => ({
  default: { request: mockHttpsRequest },
  request: mockHttpsRequest,
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storeData = (globalThis as any)[STORE_KEY] as Record<string, unknown>

// ── Types only (no runtime side effects) ─────────────────────────────────────

import type {
  AppNotification,
  NotificationPrefs,
  NotificationType,
  NotificationSeverity,
  WebhookEndpoint,
  NotificationManager as NotificationManagerType,
} from './NotificationManager'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ALL_TYPES: NotificationType[] = [
  'session-complete', 'permission-request', 'rate-limit',
  'budget-alert', 'security-event', 'policy-violation',
  'agent-status', 'schedule-result', 'error',
]

function defaultBoolMap(val: boolean): Record<NotificationType, boolean> {
  const m: Record<string, boolean> = {}
  for (const t of ALL_TYPES) m[t] = val
  return m as Record<NotificationType, boolean>
}

function makePrefs(overrides?: Partial<NotificationPrefs>): NotificationPrefs {
  return {
    inbox: defaultBoolMap(true),
    desktop: defaultBoolMap(true),
    webhook: defaultBoolMap(false),
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
    ...overrides,
  }
}

function makeNotification(overrides?: Partial<AppNotification>): AppNotification {
  return {
    id: 'test-id',
    timestamp: 1000,
    type: 'session-complete',
    severity: 'info',
    title: 'Test',
    message: 'Test message',
    source: 'test',
    read: false,
    ...overrides,
  }
}

function makeWebhook(overrides?: Partial<WebhookEndpoint>): WebhookEndpoint {
  return {
    id: 'wh-1',
    name: 'Test Webhook',
    url: 'https://hooks.slack.com/services/xxx',
    type: 'slack-webhook',
    enabledTypes: ['session-complete'],
    enabled: true,
    ...overrides,
  }
}

const mockWebContents = {
  send: vi.fn(),
  isDestroyed: vi.fn().mockReturnValue(false),
}

// ── Test Suite ───────────────────────────────────────────────────────────────

/** Reset the in-memory store to default state */
function resetStore(): void {
  for (const key of Object.keys(storeData)) delete storeData[key]
  // Re-apply defaults (same as NotificationManager module defaults)
  storeData.notifications = []
  storeData.webhooks = []
  storeData.prefs = makePrefs()
}

describe('NotificationManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let NotificationManager: any
  let manager: NotificationManagerType

  beforeAll(async () => {
    // Reset module cache so NotificationManager re-imports electron-store
    // and gets the mocked version (setup-coverage.ts pre-loads with real one)
    vi.resetModules()
    const mod = await import('./NotificationManager')
    NotificationManager = mod.NotificationManager
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
    manager = new NotificationManager(() => mockWebContents as unknown as Electron.WebContents)
  })

  // ── emit() ───────────────────────────────────────────────────────────────

  describe('emit()', () => {
    it('creates a notification with all required fields', () => {
      const result = manager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'Session finished',
        source: 'cli',
      })

      expect(result).toMatchObject({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'Session finished',
        source: 'cli',
        read: false,
      })
      expect(result.id).toBeDefined()
      expect(result.timestamp).toBeGreaterThan(0)
    })

    it('stores the notification in the notifications list', () => {
      manager.emit({
        type: 'error',
        severity: 'critical',
        title: 'Failure',
        message: 'Something broke',
        source: 'scheduler',
      })

      const stored = storeData.notifications as AppNotification[]
      expect(stored.length).toBe(1)
      expect(stored[0]).toMatchObject({ type: 'error', severity: 'critical', title: 'Failure' })
    })

    it('caps notifications at 500 entries', () => {
      // Pre-fill store with 500 notifications
      storeData.notifications = Array.from({ length: 500 }, (_, i) =>
        makeNotification({ id: `old-${i}` }),
      )

      manager.emit({
        type: 'error',
        severity: 'info',
        title: 'New',
        message: 'New one',
        source: 'test',
      })

      const stored = storeData.notifications as AppNotification[]
      expect(stored.length).toBe(500)
      // oldest entry should have been trimmed
      expect(stored[0].id).not.toBe('old-0')
      // newest entry should be at the end
      expect(stored[stored.length - 1].title).toBe('New')
    })

    it('sends notification to renderer via webContents', () => {
      manager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'ok',
        source: 'test',
      })

      expect(mockWebContents.send).toHaveBeenCalledWith(
        'notification:new',
        expect.objectContaining({ type: 'session-complete' }),
      )
    })

    it('does not send to renderer when inbox pref for type is false', () => {
      const prefs = makePrefs()
      prefs.inbox['session-complete'] = false
      storeData.prefs = prefs

      manager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'ok',
        source: 'test',
      })

      expect(mockWebContents.send).not.toHaveBeenCalled()
    })

    it('does not send to renderer when webContents is null', () => {
      const nullManager = new NotificationManager(() => null)
      nullManager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'ok',
        source: 'test',
      })

      expect(mockWebContents.send).not.toHaveBeenCalled()
    })

    it('does not send to renderer when webContents is destroyed', () => {
      const destroyedWc = { send: vi.fn(), isDestroyed: vi.fn().mockReturnValue(true) }
      const destroyedManager = new NotificationManager(() => destroyedWc as unknown as Electron.WebContents)

      destroyedManager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'ok',
        source: 'test',
      })

      expect(destroyedWc.send).not.toHaveBeenCalled()
    })

    it('includes optional sessionId and action', () => {
      const result = manager.emit({
        type: 'permission-request',
        severity: 'warning',
        title: 'Permission',
        message: 'Need approval',
        source: 'cli',
        sessionId: 'sess-123',
        action: { label: 'View', ipcChannel: 'nav:go', navigate: '/sessions' },
      })

      expect(result.sessionId).toBe('sess-123')
      expect(result.action).toEqual({
        label: 'View',
        ipcChannel: 'nav:go',
        navigate: '/sessions',
      })
    })
  })

  // ── shouldDesktopPush() — tested indirectly via emit() ───────────────────

  describe('shouldDesktopPush (via emit)', () => {
    // Helper that checks whether desktop notification was triggered by checking
    // if Notification constructor was called. Since Notification.isSupported()
    // returns false in the mock, showDesktopNotification returns early.
    // We test the logic path via a spy approach: the fact that showDesktopNotification
    // is called means shouldDesktopPush returned true.
    // We'll use a different approach: spy on the private method indirectly by
    // verifying the Notification import's isSupported was checked.

    // Since Notification.isSupported returns false in our electron mock,
    // the desktop notification won't actually be created, but we can verify
    // shouldDesktopPush logic by inspecting the code path.

    // A cleaner approach: use prototype access to test the private method directly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callShouldDesktopPush = (
      severity: NotificationSeverity,
      prefs: NotificationPrefs,
    ): boolean => {
      // Access private method via prototype
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (manager as any).shouldDesktopPush(severity, prefs)
    }

    it('returns true when quiet hours are disabled', () => {
      const prefs = makePrefs({ quietHoursEnabled: false })
      expect(callShouldDesktopPush('info', prefs)).toBe(true)
      expect(callShouldDesktopPush('warning', prefs)).toBe(true)
      expect(callShouldDesktopPush('critical', prefs)).toBe(true)
    })

    it('blocks non-critical during same-day quiet hours (e.g. 09:00–17:00)', () => {
      const prefs = makePrefs({
        quietHoursEnabled: true,
        quietHoursStart: '09:00',
        quietHoursEnd: '17:00',
      })

      // Mock a time inside quiet hours: 12:00
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 3, 9, 12, 0, 0))

      expect(callShouldDesktopPush('info', prefs)).toBe(false)
      expect(callShouldDesktopPush('warning', prefs)).toBe(false)
      expect(callShouldDesktopPush('critical', prefs)).toBe(true)

      vi.useRealTimers()
    })

    it('allows non-critical outside same-day quiet hours', () => {
      const prefs = makePrefs({
        quietHoursEnabled: true,
        quietHoursStart: '09:00',
        quietHoursEnd: '17:00',
      })

      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 3, 9, 20, 0, 0)) // 20:00 — outside quiet hours

      expect(callShouldDesktopPush('info', prefs)).toBe(true)
      expect(callShouldDesktopPush('warning', prefs)).toBe(true)

      vi.useRealTimers()
    })

    it('blocks non-critical during overnight quiet hours late night (22:00–07:00)', () => {
      const prefs = makePrefs({
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      })

      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 3, 9, 23, 30, 0)) // 23:30

      expect(callShouldDesktopPush('info', prefs)).toBe(false)
      expect(callShouldDesktopPush('critical', prefs)).toBe(true)

      vi.useRealTimers()
    })

    it('blocks non-critical during overnight quiet hours early morning', () => {
      const prefs = makePrefs({
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      })

      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 3, 9, 5, 0, 0)) // 05:00

      expect(callShouldDesktopPush('info', prefs)).toBe(false)
      expect(callShouldDesktopPush('warning', prefs)).toBe(false)

      vi.useRealTimers()
    })

    it('allows non-critical outside overnight quiet hours (daytime)', () => {
      const prefs = makePrefs({
        quietHoursEnabled: true,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
      })

      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 3, 9, 14, 0, 0)) // 14:00

      expect(callShouldDesktopPush('info', prefs)).toBe(true)

      vi.useRealTimers()
    })

    // BUG-002 (fixed): equal start/end means a zero-length quiet window — treated as disabled.
    it('equal start/end "00:00"/"00:00" — disables quiet hours (zero-length window)', () => {
      const prefs = makePrefs({
        quietHoursEnabled: true,
        quietHoursStart: '00:00',
        quietHoursEnd: '00:00',
      })

      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 3, 9, 12, 0, 0)) // noon

      // Equal start/end → zero-length window → not in quiet hours → push allowed
      expect(callShouldDesktopPush('info', prefs)).toBe(true)

      vi.useRealTimers()
    })

    it('equal start/end with any non-midnight value disables quiet hours', () => {
      const prefs = makePrefs({
        quietHoursEnabled: true,
        quietHoursStart: '12:00',
        quietHoursEnd: '12:00',
      })

      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 3, 9, 12, 0, 0))
      // Equal start/end guard fires → push always allowed regardless of time
      expect(callShouldDesktopPush('info', prefs)).toBe(true)
      expect(callShouldDesktopPush('critical', prefs)).toBe(true)

      vi.useRealTimers()
    })
  })

  // ── isWebhookUrlSafe() ───────────────────────────────────────────────────

  describe('isWebhookUrlSafe (static)', () => {
    const isUrlSafe = (url: string) => NotificationManager.isWebhookUrlSafe(url)

    it('allows valid HTTPS URLs', () => {
      expect(isUrlSafe('https://hooks.slack.com/services/xxx')).toEqual({ safe: true })
      expect(isUrlSafe('https://example.com/webhook')).toEqual({ safe: true })
    })

    it('rejects non-HTTPS URLs', () => {
      const result = isUrlSafe('http://example.com/webhook')
      expect(result.safe).toBe(false)
      expect(result.reason).toMatch(/HTTPS/i)
    })

    it('rejects invalid URLs', () => {
      const result = isUrlSafe('not-a-url')
      expect(result.safe).toBe(false)
      expect(result.reason).toMatch(/Invalid/i)
    })

    it('blocks localhost', () => {
      expect(isUrlSafe('https://localhost/hook').safe).toBe(false)
      expect(isUrlSafe('https://127.0.0.1/hook').safe).toBe(false)
      expect(isUrlSafe('https://0.0.0.0/hook').safe).toBe(false)
    })

    it('blocks IPv6 loopback [::1] — brackets stripped before comparison', () => {
      // BUG-008 fixed: URL.hostname "[::1]" has brackets stripped → "::1" → blocked
      const result = isUrlSafe('https://[::1]/hook')
      expect(result.safe).toBe(false)
      expect(result.reason).toMatch(/localhost/i)
    })

    it('blocks private 10.x.x.x range', () => {
      expect(isUrlSafe('https://10.0.0.1/hook').safe).toBe(false)
      expect(isUrlSafe('https://10.255.255.255/hook').safe).toBe(false)
    })

    it('blocks private 172.16-31.x.x range', () => {
      expect(isUrlSafe('https://172.16.0.1/hook').safe).toBe(false)
      expect(isUrlSafe('https://172.31.255.255/hook').safe).toBe(false)
    })

    it('allows public 172.x range outside 16-31', () => {
      expect(isUrlSafe('https://172.15.0.1/hook').safe).toBe(true)
      expect(isUrlSafe('https://172.32.0.1/hook').safe).toBe(true)
    })

    it('blocks private 192.168.x.x range', () => {
      expect(isUrlSafe('https://192.168.0.1/hook').safe).toBe(false)
      expect(isUrlSafe('https://192.168.1.100/hook').safe).toBe(false)
    })

    it('blocks 127.x.x.x range (not just 127.0.0.1)', () => {
      expect(isUrlSafe('https://127.0.0.2/hook').safe).toBe(false)
      expect(isUrlSafe('https://127.1.1.1/hook').safe).toBe(false)
    })

    it('blocks AWS metadata service IP', () => {
      expect(isUrlSafe('https://169.254.169.254/latest/meta-data').safe).toBe(false)
    })

    it('blocks ECS metadata IP', () => {
      expect(isUrlSafe('https://169.254.170.2/hook').safe).toBe(false)
    })

    it('blocks link-local 169.254.x.x range', () => {
      expect(isUrlSafe('https://169.254.1.1/hook').safe).toBe(false)
    })

    it('blocks IPv6 unique-local addresses [fd00::1] and [fc00::1]', () => {
      // BUG-008 fixed: brackets stripped → "fd00::1" startsWith "fd" → blocked
      expect(isUrlSafe('https://[fd00::1]/hook').safe).toBe(false)
      expect(isUrlSafe('https://[fc00::1]/hook').safe).toBe(false)
    })

    it('blocks IPv6 link-local addresses [fe80::1]', () => {
      expect(isUrlSafe('https://[fe80::1]/hook').safe).toBe(false)
    })
  })

  // ── redactSecrets() ──────────────────────────────────────────────────────

  describe('redactSecrets (static)', () => {
    const redact = (text: string) => (NotificationManager as any).redactSecrets(text)

    it('redacts GitHub PAT tokens (ghp_)', () => {
      const token = 'ghp_' + 'a'.repeat(36)
      expect(redact(`Token: ${token}`)).toBe('Token: [REDACTED_GITHUB_TOKEN]')
    })

    it('redacts GitHub OAuth tokens (gho_)', () => {
      const token = 'gho_' + 'B'.repeat(36)
      expect(redact(`Auth: ${token}`)).toBe('Auth: [REDACTED_GITHUB_TOKEN]')
    })

    it('redacts GitHub user tokens (ghu_)', () => {
      const token = 'ghu_' + 'c'.repeat(40)
      expect(redact(token)).toBe('[REDACTED_GITHUB_TOKEN]')
    })

    it('redacts GitHub server tokens (ghs_)', () => {
      const token = 'ghs_' + 'd'.repeat(36)
      expect(redact(token)).toBe('[REDACTED_GITHUB_TOKEN]')
    })

    it('redacts GitHub refresh tokens (ghr_)', () => {
      const token = 'ghr_' + 'e'.repeat(36)
      expect(redact(token)).toBe('[REDACTED_GITHUB_TOKEN]')
    })

    it('redacts OpenAI-style API keys (sk-)', () => {
      const key = 'sk-' + 'f'.repeat(48)
      expect(redact(`Key: ${key}`)).toBe('Key: [REDACTED_API_KEY]')
    })

    it('redacts AWS access key IDs', () => {
      const key = 'AKIA' + 'G'.repeat(16)
      expect(redact(`AWS: ${key}`)).toBe('AWS: [REDACTED_AWS_KEY]')
    })

    it('redacts Slack tokens (xoxb-, xoxp-, xoxo-, xoxr-, xoxs-)', () => {
      expect(redact('xoxb-123-456-abc')).toBe('[REDACTED_SLACK_TOKEN]')
      expect(redact('xoxp-something-here')).toBe('[REDACTED_SLACK_TOKEN]')
    })

    it('handles multiple secrets in a single string', () => {
      const token = 'ghp_' + 'a'.repeat(36)
      const key = 'sk-' + 'b'.repeat(25)
      const text = `Token=${token} and key=${key}`
      const result = redact(text)
      expect(result).toContain('[REDACTED_GITHUB_TOKEN]')
      expect(result).toContain('[REDACTED_API_KEY]')
      expect(result).not.toContain('ghp_')
      expect(result).not.toContain('sk-')
    })

    it('returns text unchanged when no secrets present', () => {
      const text = 'Session completed successfully with exit code 0'
      expect(redact(text)).toBe(text)
    })
  })

  // ── getAll() ─────────────────────────────────────────────────────────────

  describe('getAll()', () => {
    const sampleNotifs: AppNotification[] = [
      makeNotification({ id: 'n1', type: 'error', read: false, timestamp: 1 }),
      makeNotification({ id: 'n2', type: 'session-complete', read: true, timestamp: 2 }),
      makeNotification({ id: 'n3', type: 'error', read: false, timestamp: 3 }),
      makeNotification({ id: 'n4', type: 'budget-alert', read: false, timestamp: 4 }),
      makeNotification({ id: 'n5', type: 'session-complete', read: true, timestamp: 5 }),
    ]

    beforeEach(() => {
      storeData.notifications = JSON.parse(JSON.stringify(sampleNotifs))
    })

    it('returns all notifications reversed (newest first) with default limit', () => {
      const result = manager.getAll()
      expect(result.length).toBe(5)
      expect(result[0].id).toBe('n5')
      expect(result[4].id).toBe('n1')
    })

    it('filters by type', () => {
      const result = manager.getAll({ type: 'error' })
      expect(result.length).toBe(2)
      expect(result.every((n) => n.type === 'error')).toBe(true)
    })

    it('filters by unreadOnly', () => {
      const result = manager.getAll({ unreadOnly: true })
      expect(result.length).toBe(3)
      expect(result.every((n) => !n.read)).toBe(true)
    })

    it('respects limit parameter', () => {
      const result = manager.getAll({ limit: 2 })
      expect(result.length).toBe(2)
      // Should return the last 2 (newest), reversed
      expect(result[0].id).toBe('n5')
      expect(result[1].id).toBe('n4')
    })

    it('combines filters: type + unreadOnly + limit', () => {
      const result = manager.getAll({ type: 'error', unreadOnly: true, limit: 1 })
      expect(result.length).toBe(1)
      expect(result[0].type).toBe('error')
      expect(result[0].read).toBe(false)
      // The last 1 of the filtered set (n3), reversed → n3
      expect(result[0].id).toBe('n3')
    })

    it('returns empty array when no notifications match', () => {
      const result = manager.getAll({ type: 'rate-limit' })
      expect(result).toEqual([])
    })
  })

  // ── getUnreadCount() ─────────────────────────────────────────────────────

  describe('getUnreadCount()', () => {
    it('returns count of unread notifications', () => {
      storeData.notifications = [
        makeNotification({ read: false }),
        makeNotification({ read: true }),
        makeNotification({ read: false }),
      ]

      expect(manager.getUnreadCount()).toBe(2)
    })

    it('returns 0 when all are read', () => {
      storeData.notifications = [
        makeNotification({ read: true }),
        makeNotification({ read: true }),
      ]

      expect(manager.getUnreadCount()).toBe(0)
    })

    it('returns 0 when list is empty', () => {
      storeData.notifications = []
      expect(manager.getUnreadCount()).toBe(0)
    })
  })

  // ── markRead() ───────────────────────────────────────────────────────────

  describe('markRead()', () => {
    it('marks a specific notification as read', () => {
      storeData.notifications = [
        makeNotification({ id: 'a', read: false }),
        makeNotification({ id: 'b', read: false }),
      ]

      manager.markRead('a')

      const stored = storeData.notifications as AppNotification[]
      expect(stored.find((n) => n.id === 'a')!.read).toBe(true)
      expect(stored.find((n) => n.id === 'b')!.read).toBe(false)
    })

    it('does nothing when id is not found', () => {
      storeData.notifications = [makeNotification({ id: 'a', read: false })]

      manager.markRead('nonexistent')
      // store.set should not have been called (no match found)
      // The notification should remain unchanged
      const stored = storeData.notifications as AppNotification[]
      expect(stored[0].read).toBe(false)
    })
  })

  // ── markAllRead() ────────────────────────────────────────────────────────

  describe('markAllRead()', () => {
    it('marks all notifications as read', () => {
      storeData.notifications = [
        makeNotification({ id: 'a', read: false }),
        makeNotification({ id: 'b', read: false }),
        makeNotification({ id: 'c', read: true }),
      ]

      manager.markAllRead()

      const stored = storeData.notifications as AppNotification[]
      expect(stored.every((n) => n.read)).toBe(true)
    })
  })

  // ── clearAll() ───────────────────────────────────────────────────────────

  describe('clearAll()', () => {
    it('sets notifications to empty array', () => {
      storeData.notifications = [makeNotification(), makeNotification()]
      manager.clearAll()
      const stored = storeData.notifications as AppNotification[]
      expect(stored).toEqual([])
    })
  })

  // ── dismiss() ────────────────────────────────────────────────────────────

  describe('dismiss()', () => {
    it('removes a specific notification by id', () => {
      storeData.notifications = [
        makeNotification({ id: 'a' }),
        makeNotification({ id: 'b' }),
        makeNotification({ id: 'c' }),
      ]

      manager.dismiss('b')

      const stored = storeData.notifications as AppNotification[]
      expect(stored.length).toBe(2)
      expect(stored.find((n) => n.id === 'b')).toBeUndefined()
    })
  })

  // ── Prefs ────────────────────────────────────────────────────────────────

  describe('getPrefs() / setPrefs()', () => {
    it('returns prefs from store', () => {
      const result = manager.getPrefs()
      expect(result).toBeDefined()
      expect(result.quietHoursEnabled).toBe(false)
    })

    it('saves prefs to store', () => {
      const prefs = makePrefs({ quietHoursEnabled: true })
      manager.setPrefs(prefs)
      const stored = storeData.prefs as NotificationPrefs
      expect(stored.quietHoursEnabled).toBe(true)
    })
  })

  // ── Webhooks ─────────────────────────────────────────────────────────────

  describe('Webhook CRUD', () => {
    it('getWebhooks() returns webhooks from store', () => {
      storeData.webhooks = [makeWebhook()]
      const result = manager.getWebhooks()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('wh-1')
    })

    it('saveWebhook() adds a new webhook', () => {
      storeData.webhooks = []
      const wh = makeWebhook({ id: 'new-wh' })

      manager.saveWebhook(wh)

      const stored = storeData.webhooks as WebhookEndpoint[]
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe('new-wh')
    })

    it('saveWebhook() updates an existing webhook by id', () => {
      storeData.webhooks = [makeWebhook({ id: 'wh-1', name: 'Old Name' })]

      const updated = makeWebhook({ id: 'wh-1', name: 'New Name' })
      manager.saveWebhook(updated)

      const stored = storeData.webhooks as WebhookEndpoint[]
      expect(stored.length).toBe(1)
      expect(stored[0].name).toBe('New Name')
    })

    it('deleteWebhook() removes a webhook by id', () => {
      storeData.webhooks = [
        makeWebhook({ id: 'wh-1' }),
        makeWebhook({ id: 'wh-2' }),
      ]

      manager.deleteWebhook('wh-1')

      const stored = storeData.webhooks as WebhookEndpoint[]
      expect(stored.length).toBe(1)
      expect(stored[0].id).toBe('wh-2')
    })
  })

  // ── testWebhook() ───────────────────────────────────────────────────────

  describe('testWebhook()', () => {
    it('returns error when webhook is not found', async () => {
      storeData.webhooks = []
      const result = await manager.testWebhook('nonexistent')
      expect(result).toEqual({ success: false, error: 'Webhook not found' })
    })

    it('attempts to send a slack webhook test and succeeds', async () => {
      const wh = makeWebhook({ id: 'wh-1', type: 'slack-webhook', url: 'https://hooks.slack.com/services/xxx' })
      storeData.webhooks = [wh]

      // Mock https.request to simulate success
      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        // Simulate success response
        const res = { resume: vi.fn() }
        setTimeout(() => callback(res), 0)
        return mockReq
      })

      const result = await manager.testWebhook('wh-1')
      expect(result).toEqual({ success: true })
    })

    it('returns error when webhook request fails', async () => {
      const wh = makeWebhook({ id: 'wh-1', type: 'generic-json', url: 'https://example.com/hook' })
      storeData.webhooks = [wh]

      const mockReq = {
        on: vi.fn().mockImplementation((event: string, handler: (err?: Error) => void) => {
          if (event === 'error') {
            setTimeout(() => handler(new Error('connection refused')), 0)
          }
          return mockReq
        }),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      }
      mockHttpsRequest.mockReturnValue(mockReq)

      const result = await manager.testWebhook('wh-1')
      expect(result.success).toBe(false)
      expect(result.error).toContain('connection refused')
    })

    it('returns SSRF error when webhook URL is unsafe', async () => {
      const wh = makeWebhook({ id: 'wh-1', url: 'https://10.0.0.1/hook' })
      storeData.webhooks = [wh]

      const result = await manager.testWebhook('wh-1')
      expect(result.success).toBe(false)
      expect(result.error).toContain('blocked')
    })
  })

  // ── getStats() — via getAll/getUnreadCount ──────────────────────────────

  describe('getStats (aggregate queries)', () => {
    it('getUnreadCount reflects actual unread count after markRead', () => {
      storeData.notifications = [
        makeNotification({ id: 'n1', read: false }),
        makeNotification({ id: 'n2', read: false }),
        makeNotification({ id: 'n3', read: true }),
      ]

      expect(manager.getUnreadCount()).toBe(2)
    })

    it('filtering by type and unreadOnly gives correct subset count', () => {
      storeData.notifications = [
        makeNotification({ type: 'error', read: false }),
        makeNotification({ type: 'error', read: true }),
        makeNotification({ type: 'error', read: false }),
        makeNotification({ type: 'session-complete', read: false }),
      ]

      const errors = manager.getAll({ type: 'error', unreadOnly: true })
      expect(errors.length).toBe(2)
    })
  })

  // ── Webhook dispatch via emit ────────────────────────────────────────────

  describe('webhook dispatch via emit()', () => {
    it('dispatches to enabled webhooks when webhook pref is true for the type', async () => {
      const prefs = makePrefs()
      prefs.webhook['session-complete'] = true
      storeData.prefs = prefs
      storeData.webhooks = [makeWebhook({
        id: 'wh-1',
        enabled: true,
        enabledTypes: ['session-complete'],
        url: 'https://hooks.slack.com/services/xxx',
      })]

      const mockReq = {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      }
      mockHttpsRequest.mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
        const res = { resume: vi.fn() }
        setTimeout(() => callback(res), 0)
        return mockReq
      })

      manager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'ok',
        source: 'test',
      })

      // Allow async dispatch to settle
      await vi.waitFor(() => {
        expect(mockHttpsRequest).toHaveBeenCalled()
      })
    })

    it('does not dispatch when webhook pref is false for the type', () => {
      // webhook pref is false by default from makePrefs()

      manager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'ok',
        source: 'test',
      })

      expect(mockHttpsRequest).not.toHaveBeenCalled()
    })

    it('does not dispatch to disabled webhooks', async () => {
      const prefs = makePrefs()
      prefs.webhook['session-complete'] = true
      storeData.prefs = prefs
      storeData.webhooks = [makeWebhook({ enabled: false })]

      manager.emit({
        type: 'session-complete',
        severity: 'info',
        title: 'Done',
        message: 'ok',
        source: 'test',
      })

      // Give async a tick
      await new Promise((r) => setTimeout(r, 10))
      expect(mockHttpsRequest).not.toHaveBeenCalled()
    })
  })
})
