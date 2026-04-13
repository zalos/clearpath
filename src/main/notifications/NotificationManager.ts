import { Notification, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { randomUUID } from 'crypto'
import https from 'https'
import { getStoreEncryptionKey } from '../utils/storeEncryption'

// ── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'session-complete' | 'permission-request' | 'rate-limit'
  | 'budget-alert' | 'security-event' | 'policy-violation'
  | 'agent-status' | 'schedule-result' | 'error'

export type NotificationSeverity = 'info' | 'warning' | 'critical'

export interface NotificationAction {
  label: string
  ipcChannel: string
  args?: Record<string, unknown>
  /** Deep-link navigation target when the notification is clicked */
  navigate?: string
  tab?: string
  panel?: string
}

export interface AppNotification {
  id: string
  timestamp: number
  type: NotificationType
  severity: NotificationSeverity
  title: string
  message: string
  source: string
  sessionId?: string
  action?: NotificationAction
  read: boolean
}

export interface WebhookEndpoint {
  id: string
  name: string
  url: string
  type: 'slack-webhook' | 'generic-json' | 'email-smtp'
  enabledTypes: NotificationType[]
  smtpConfig?: { host: string; port: number; user: string; pass: string; to: string }
  enabled: boolean
}

export interface NotificationPrefs {
  /** Per-type toggles */
  inbox: Record<NotificationType, boolean>
  desktop: Record<NotificationType, boolean>
  webhook: Record<NotificationType, boolean>
  /** Quiet hours — only critical desktop pushes during this window */
  quietHoursEnabled: boolean
  quietHoursStart: string // "22:00"
  quietHoursEnd: string   // "07:00"
}

interface NotificationStoreSchema {
  notifications: AppNotification[]
  webhooks: WebhookEndpoint[]
  prefs: NotificationPrefs
}

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

const DEFAULT_PREFS: NotificationPrefs = {
  inbox: defaultBoolMap(true),
  desktop: {
    ...defaultBoolMap(false),
    'session-complete': true,
    'permission-request': true,
    'budget-alert': true,
    'security-event': true,
    'policy-violation': true,
    'error': true,
  } as Record<NotificationType, boolean>,
  webhook: defaultBoolMap(false),
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
}

const store = new Store<NotificationStoreSchema>({
  name: 'clear-path-notifications',
  encryptionKey: getStoreEncryptionKey(),
  defaults: {
    notifications: [],
    webhooks: [],
    prefs: DEFAULT_PREFS,
  },
})

// ── NotificationManager ──────────────────────────────────────────────────────

export class NotificationManager {
  private getWebContents: () => Electron.WebContents | null

  constructor(getWebContents: () => Electron.WebContents | null) {
    this.getWebContents = getWebContents
  }

  /** Central entry point — every slice calls this to emit a notification. */
  emit(args: {
    type: NotificationType
    severity: NotificationSeverity
    title: string
    message: string
    source: string
    sessionId?: string
    action?: NotificationAction
  }): AppNotification {
    const prefs = store.get('prefs')
    const notif: AppNotification = {
      id: randomUUID(),
      timestamp: Date.now(),
      type: args.type,
      severity: args.severity,
      title: args.title,
      message: args.message,
      source: args.source,
      sessionId: args.sessionId,
      action: args.action,
      read: false,
    }

    // 1. Store in history (cap at 500)
    const list = store.get('notifications')
    list.push(notif)
    if (list.length > 500) list.splice(0, list.length - 500)
    store.set('notifications', list)

    // 2. Send to renderer inbox (if type enabled)
    if (prefs.inbox[args.type] !== false) {
      const wc = this.getWebContents()
      if (wc && !wc.isDestroyed()) {
        wc.send('notification:new', notif)
      }
    }

    // 3. Desktop OS notification (if type enabled + severity check + quiet hours)
    if (prefs.desktop[args.type] && this.shouldDesktopPush(args.severity, prefs)) {
      this.showDesktopNotification(notif)
    }

    // 4. Webhook dispatch (async, non-blocking)
    if (prefs.webhook[args.type]) {
      void this.dispatchWebhooks(notif)
    }

    return notif
  }

  private shouldDesktopPush(severity: NotificationSeverity, prefs: NotificationPrefs): boolean {
    if (!prefs.quietHoursEnabled) return true
    // BUG-002: equal start/end means a zero-length window — treat as disabled
    if (prefs.quietHoursStart === prefs.quietHoursEnd) return true
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const inQuiet = prefs.quietHoursStart <= prefs.quietHoursEnd
      ? hhmm >= prefs.quietHoursStart && hhmm < prefs.quietHoursEnd
      : hhmm >= prefs.quietHoursStart || hhmm < prefs.quietHoursEnd
    // During quiet hours, only critical notifications push
    if (inQuiet && severity !== 'critical') return false
    return true
  }

  private showDesktopNotification(notif: AppNotification): void {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: notif.title,
      body: notif.message.slice(0, 200),
      silent: notif.severity === 'info',
    })
    n.on('click', () => {
      // Bring app to focus
      const wins = BrowserWindow.getAllWindows()
      if (wins.length > 0) {
        const win = wins[0]
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    })
    n.show()
  }

  private async dispatchWebhooks(notif: AppNotification): Promise<void> {
    const webhooks = store.get('webhooks')
    for (const wh of webhooks) {
      if (!wh.enabled) continue
      if (!wh.enabledTypes.includes(notif.type)) continue

      try {
        if (wh.type === 'slack-webhook') {
          await this.sendSlackWebhook(wh.url, notif)
        } else if (wh.type === 'generic-json') {
          await this.sendGenericWebhook(wh.url, notif)
        }
        // email-smtp would require nodemailer — skip for now, log intent
      } catch (err) {
        console.error(`[NotificationManager] Webhook ${wh.name} failed:`, err)
      }
    }
  }

  private sendSlackWebhook(url: string, notif: AppNotification): Promise<void> {
    const colorMap: Record<string, string> = {
      info: '#3B82F6',
      warning: '#F59E0B',
      critical: '#EF4444',
    }
    const payload = {
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${notif.title}*\n${notif.message}`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Source: ${notif.source} | Type: ${notif.type} | ${new Date(notif.timestamp).toLocaleString()}` },
          ],
        },
      ],
      attachments: [{ color: colorMap[notif.severity] ?? '#6366F1', blocks: [] }],
    }
    return this.postJson(url, payload)
  }

  private sendGenericWebhook(url: string, notif: AppNotification): Promise<void> {
    // Strip potentially sensitive fields before sending externally
    const safePayload = {
      id: notif.id,
      timestamp: notif.timestamp,
      type: notif.type,
      severity: notif.severity,
      title: notif.title,
      // Truncate message and strip anything that looks like a secret
      message: NotificationManager.redactSecrets(notif.message.slice(0, 500)),
      source: notif.source,
      // Deliberately omit: sessionId, action (may contain IPC channels/navigation info)
    }
    return this.postJson(url, safePayload)
  }

  /** Redact common secret patterns from text before external transmission. */
  private static redactSecrets(text: string): string {
    return text
      .replace(/(?:ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9]{36,}/g, '[REDACTED_GITHUB_TOKEN]')
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]')
      .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
      .replace(/xox[bpors]-[a-zA-Z0-9-]+/g, '[REDACTED_SLACK_TOKEN]')
  }

  /**
   * Validate that a webhook URL is safe to request.
   * Blocks: non-HTTPS, localhost, private IPs, link-local, metadata services.
   * Public so IPC handlers can reuse it instead of duplicating the logic (BUG-016).
   */
  static isWebhookUrlSafe(url: string): { safe: boolean; reason?: string } {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { safe: false, reason: 'Invalid URL' }
    }

    // Require HTTPS
    if (parsed.protocol !== 'https:') {
      return { safe: false, reason: 'Only HTTPS URLs are allowed for webhooks' }
    }

    // BUG-008: URL.hostname returns IPv6 addresses wrapped in brackets (e.g. "[::1]").
    // Strip the brackets so all subsequent checks work correctly.
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()

    // Block localhost and loopback
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
      return { safe: false, reason: 'Localhost URLs are not allowed' }
    }

    // Block private IP ranges
    if (/^10\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^127\./.test(host)) {
      return { safe: false, reason: 'Private IP addresses are not allowed' }
    }

    // Block link-local and metadata service IPs
    // BUG-008: fe80::/10 (link-local) IPv6 range added alongside fc/fd unique-local
    if (host === '169.254.169.254' || host === '169.254.170.2' ||
        host.startsWith('fd') || host.startsWith('fc') || host.startsWith('fe80') ||
        /^169\.254\./.test(host)) {
      return { safe: false, reason: 'Metadata service and link-local addresses are not allowed' }
    }

    return { safe: true }
  }

  private postJson(url: string, body: unknown): Promise<void> {
    // SSRF protection: validate URL before making the request
    const urlCheck = NotificationManager.isWebhookUrlSafe(url)
    if (!urlCheck.safe) {
      return Promise.reject(new Error(`Webhook URL blocked: ${urlCheck.reason}`))
    }

    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body)
      const parsed = new URL(url)
      const req = https.request(
        { hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
          timeout: 10000,
        },
        (res) => { res.resume(); resolve() },
      )
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
      req.write(data)
      req.end()
    })
  }

  // ── Query methods ──────────────────────────────────────────────────────────

  getAll(opts?: { limit?: number; type?: string; unreadOnly?: boolean }): AppNotification[] {
    let list = store.get('notifications')
    if (opts?.type) list = list.filter((n) => n.type === opts.type)
    if (opts?.unreadOnly) list = list.filter((n) => !n.read)
    return list.slice(-(opts?.limit ?? 100)).reverse()
  }

  getUnreadCount(): number {
    return store.get('notifications').filter((n) => !n.read).length
  }

  markRead(id: string): void {
    const list = store.get('notifications')
    const idx = list.findIndex((n) => n.id === id)
    if (idx >= 0) { list[idx].read = true; store.set('notifications', list) }
  }

  markAllRead(): void {
    const list = store.get('notifications').map((n) => ({ ...n, read: true }))
    store.set('notifications', list)
  }

  clearAll(): void {
    store.set('notifications', [])
  }

  dismiss(id: string): void {
    store.set('notifications', store.get('notifications').filter((n) => n.id !== id))
  }

  // ── Prefs ──────────────────────────────────────────────────────────────────

  getPrefs(): NotificationPrefs { return store.get('prefs') }
  setPrefs(prefs: NotificationPrefs): void { store.set('prefs', prefs) }

  // ── Webhooks ───────────────────────────────────────────────────────────────

  getWebhooks(): WebhookEndpoint[] { return store.get('webhooks') }

  saveWebhook(wh: WebhookEndpoint): void {
    const list = store.get('webhooks')
    const idx = list.findIndex((w) => w.id === wh.id)
    if (idx >= 0) list[idx] = wh
    else list.push(wh)
    store.set('webhooks', list)
  }

  deleteWebhook(id: string): void {
    store.set('webhooks', store.get('webhooks').filter((w) => w.id !== id))
  }

  async testWebhook(id: string): Promise<{ success: boolean; error?: string }> {
    const wh = store.get('webhooks').find((w) => w.id === id)
    if (!wh) return { success: false, error: 'Webhook not found' }
    const testNotif: AppNotification = {
      id: 'test', timestamp: Date.now(), type: 'agent-status', severity: 'info',
      title: 'Test Notification', message: 'This is a test from Clear Path.',
      source: 'webhook-test', read: false,
    }
    try {
      if (wh.type === 'slack-webhook') await this.sendSlackWebhook(wh.url, testNotif)
      else await this.sendGenericWebhook(wh.url, testNotif)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }
}
