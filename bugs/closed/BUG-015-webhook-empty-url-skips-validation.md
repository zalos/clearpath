# BUG-015: Webhook save skips URL validation when URL is empty or falsy

## Severity
Medium

## Location
`src/main/ipc/notificationHandlers.ts` — `notifications:save-webhook` handler (line 62)

## Description
The webhook save handler guards URL validation with `if (args.url)`, which means that when `args.url` is an empty string `""`, `undefined`, or `null`, the entire validation block is skipped. The webhook is then saved with no URL (or an empty URL) without any error being returned.

This allows a webhook endpoint to be persisted without a valid URL, which would silently fail when the system attempts to deliver notifications to it. It also bypasses the HTTPS-only and private-IP security checks.

## Steps to Reproduce
1. Call `notifications:save-webhook` with `{ name: 'Test', url: '', type: 'generic-json', enabledTypes: [], enabled: true }`
2. Observe: webhook is saved successfully with an empty URL
3. Expected: an error should be returned (e.g., `"Webhook URL is required"`)

## Root Cause
```typescript
if (args.url) {  // <-- falsy check skips validation for empty string
  try {
    const parsed = new URL(args.url)
    // ... validation ...
  }
}
// Falls through to save without validation
const wh: WebhookEndpoint = { ...args, id: args.id ?? randomUUID() }
manager.saveWebhook(wh)
```

## Suggested Fix
Add a check that rejects empty/missing URLs before the validation block:
```typescript
if (!args.url || args.url.trim() === '') {
  return { error: 'Webhook URL is required' }
}
```

## Discovered During
Unit testing of `notificationHandlers.ts` — `notificationHandlers.test.ts`
