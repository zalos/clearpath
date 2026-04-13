# BUG-027: NotificationPreferences crashes when prefs object is partially populated

## Status
Open

## Severity
High — renders Settings page unusable for the Notifications tab

## Description
`NotificationPreferences` component crashes with `TypeError: Cannot read properties of undefined` when the result of `notifications:get-prefs` IPC call returns an object that is present (truthy) but missing one or more of the `inbox`, `desktop`, or `webhook` keys.

## Root Cause
In `NotificationPreferences.tsx`, the component guard is:
```typescript
if (!prefs) return <div>Loading preferences...</div>
```
This only guards against `null`/`undefined`. If `prefs` is `{}` or any object missing the sub-keys, the render proceeds to access `prefs[ch][type]` (e.g. `prefs['inbox']['session-complete']`), which throws when `prefs['inbox']` is `undefined`.

## Reproduction Steps
1. Navigate to Settings → Notifications tab
2. If `notifications:get-prefs` returns `{}` or an object without `inbox`/`desktop`/`webhook` keys, the component crashes

## Affected File
`src/renderer/src/components/notifications/NotificationPreferences.tsx` line ~60

## Suggested Fix
Use optional chaining when accessing prefs sub-keys:
```typescript
prefs?.[ch]?.[type] ? 'bg-indigo-600' : 'bg-gray-300'
```
Or initialize with a fully-populated default object when receiving a partial response.
