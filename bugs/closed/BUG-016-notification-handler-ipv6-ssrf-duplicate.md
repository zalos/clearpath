# BUG-016: notificationHandlers webhook URL validation — IPv6 loopback bypass (duplicate of BUG-008 pattern)

## Severity
High (security — SSRF bypass)

## Location
`src/main/ipc/notificationHandlers.ts` — `notifications:save-webhook` handler (line 69)

## Description
The webhook URL validation in the IPC handler has the same IPv6 loopback bypass as BUG-008 (which is in `NotificationManager.ts`). The handler checks `host === '::1'` but `new URL('https://[::1]/hook').hostname` may return `[::1]` (with brackets) in some Node.js versions, causing the comparison to fail. This allows an IPv6 loopback webhook to pass validation.

The handler also applies the private IP regex check against the hostname string, but this regex only matches IPv4 private ranges (`10.`, `172.16-31.`, `192.168.`, `169.254.`). IPv6 unique-local addresses (`fd00::`, `fc00::`) and link-local addresses (`fe80::`) are not checked at all.

## Relation to BUG-008
BUG-008 documents the same issue in `NotificationManager.isWebhookUrlSafe()`. This is a **second instance** of the same vulnerability pattern — the webhook URL validation was duplicated in the IPC handler layer rather than reusing the manager's `isWebhookUrlSafe()`.

## Root Cause
```typescript
const host = parsed.hostname.toLowerCase()
if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host)) {
  return { error: 'Private/internal URLs are not allowed for webhooks' }
}
```

The regex-based check only covers IPv4 private ranges, and the `::1` check may fail due to bracket wrapping.

## Suggested Fix
1. Consolidate URL safety validation into a single reusable function (e.g., in the manager or a utility module)
2. Strip brackets from IPv6 hostnames before comparison
3. Add checks for IPv6 private ranges: `fc00::/7` (unique-local), `fe80::/10` (link-local)

## Discovered During
Unit testing of `notificationHandlers.ts` — `notificationHandlers.test.ts`
