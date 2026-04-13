import type { IpcMain } from 'electron'
import type { NotificationType, NotificationSeverity, NotificationAction, NotificationPrefs, WebhookEndpoint } from '../notifications/NotificationManager'
import { NotificationManager } from '../notifications/NotificationManager'
import { randomUUID } from 'crypto'
import { checkRateLimit } from '../utils/rateLimiter'

export function registerNotificationHandlers(ipcMain: IpcMain, manager: NotificationManager): void {
  // ── Emit a notification ────────────────────────────────────────────────────

  ipcMain.handle('notifications:emit', (_e, args: {
    type: NotificationType
    severity: NotificationSeverity
    title: string
    message: string
    source: string
    sessionId?: string
    action?: NotificationAction
  }) => manager.emit(args))

  // ── Query ──────────────────────────────────────────────────────────────────

  ipcMain.handle('notifications:list', (_e, args?: { limit?: number; type?: string; unreadOnly?: boolean }) =>
    manager.getAll(args),
  )

  ipcMain.handle('notifications:unread-count', () => manager.getUnreadCount())

  ipcMain.handle('notifications:mark-read', (_e, args: { id: string }) => {
    manager.markRead(args.id)
    return { success: true }
  })

  ipcMain.handle('notifications:mark-all-read', () => {
    manager.markAllRead()
    return { success: true }
  })

  ipcMain.handle('notifications:dismiss', (_e, args: { id: string }) => {
    manager.dismiss(args.id)
    return { success: true }
  })

  ipcMain.handle('notifications:clear-all', () => {
    manager.clearAll()
    return { success: true }
  })

  // ── Preferences ────────────────────────────────────────────────────────────

  ipcMain.handle('notifications:get-prefs', () => manager.getPrefs())

  ipcMain.handle('notifications:set-prefs', (_e, args: { prefs: NotificationPrefs }) => {
    manager.setPrefs(args.prefs)
    return { success: true }
  })

  // ── Webhooks ───────────────────────────────────────────────────────────────

  ipcMain.handle('notifications:list-webhooks', () => manager.getWebhooks())

  ipcMain.handle('notifications:save-webhook', (_e, args: Omit<WebhookEndpoint, 'id'> & { id?: string }) => {
    // BUG-015: reject empty/missing URLs before validation
    if (!args.url || args.url.trim() === '') {
      return { error: 'Webhook URL is required' }
    }
    // BUG-016: use shared isWebhookUrlSafe instead of duplicated inline validation
    const urlCheck = NotificationManager.isWebhookUrlSafe(args.url)
    if (!urlCheck.safe) {
      return { error: urlCheck.reason ?? 'Webhook URL is not allowed' }
    }
    const wh: WebhookEndpoint = { ...args, id: args.id ?? randomUUID() }
    manager.saveWebhook(wh)
    return wh
  })

  ipcMain.handle('notifications:delete-webhook', (_e, args: { id: string }) => {
    manager.deleteWebhook(args.id)
    return { success: true }
  })

  ipcMain.handle('notifications:test-webhook', (_e, args: { id: string }) => {
    const rl = checkRateLimit('notifications:test-webhook')
    if (!rl.allowed) return { success: false, error: `Rate limited — try again in ${Math.ceil((rl.retryAfterMs ?? 0) / 1000)}s` }
    return manager.testWebhook(args.id)
  })
}
