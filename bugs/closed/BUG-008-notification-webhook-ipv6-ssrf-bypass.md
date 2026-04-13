# BUG-008: NotificationManager — IPv6 loopback and unique-local bypass in isWebhookUrlSafe()

**Discovered:** April 9, 2026  
**File:** `src/main/notifications/NotificationManager.ts`  
**Severity:** High (security — SSRF bypass)

## Description

The `isWebhookUrlSafe()` method has two IPv6-related SSRF bypass vulnerabilities:

### 1. IPv6 Loopback Bypass
`new URL('https://[::1]/hook').hostname` returns `[::1]` (with brackets), but the source code checks `host === '::1'` (without brackets). This means IPv6 loopback addresses bypass the SSRF protection.

### 2. IPv6 Unique-Local Bypass
Similarly, `host.startsWith('fd')` and `host.startsWith('fc')` fail for IPv6 unique-local addresses because the hostname from `URL.hostname` starts with `[`. IPv6 `fd00::` and `fc00::` addresses bypass SSRF protection.

## Impact

- An attacker who can configure webhook URLs could potentially hit localhost services or private network services via IPv6 addresses
- This is an SSRF vulnerability that bypasses the existing protections

## Expected Fix

Use `URL.hostname` (which strips brackets) instead of `URL.host`, or strip brackets before comparison:
```ts
const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '')
```
