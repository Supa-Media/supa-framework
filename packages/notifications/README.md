# @supa-media/notifications

**Expo push-notification lifecycle for React Native apps** — one provider that handles
permission, token acquisition, foreground display, Android channels, and turning a
notification tap (including a cold start) into a router path. It degrades to a no-op on web,
on simulators, and when the `expo-*` native modules aren't installed.

It does **not** send notifications and does **not** store tokens. The server half is
[`@supa-media/convex/notifications`](https://github.com/Supa-Media/supa-framework/blob/main/packages/convex/src/notifications/index.ts) plus a
`pushTokens` table; you wire those up yourself.

## Install

```bash
pnpm add @supa-media/notifications
```

**Peer dependencies you install yourself:**

| Peer | Required? | Why |
| --- | --- | --- |
| `react >=19.0.0` | required | provider + hooks |
| `react-native >=0.81.0` | required | `Platform` checks |
| `expo-notifications >=0.32.0` | **optional** | the whole native surface. Without it the provider mounts, reports `isReady`, and does nothing |
| `expo-device >=8.0.0` | **optional** | physical-device check. Without it, permission is never requested |
| `expo-constants >=18.0.0` | **optional** | `projectId` fallback from `expoConfig.extra.eas.projectId` |
| `expo-router >=6.0.0` | declared, **never imported** | the package hands you a path string; you call `router.push` |

The three `expo-*` modules are loaded with a guarded `require()` at module scope, so a
missing one is caught and the feature it powers is skipped silently. In practice you want
all three.

## Mounting

Wrap your root layout once:

```tsx
// app/_layout.tsx
import { router } from "expo-router";
import { NotificationProvider } from "@supa-media/notifications";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

export default function RootLayout() {
  const registerToken = useMutation(api.notifications.registerPushToken);

  return (
    <NotificationProvider
      requestPermissionDelay={5000}
      onTokenRegistered={(token, platform) => registerToken({ token, platform })}
      onNotificationTap={(event) => router.push(event.deepLink ?? "/")}
      shouldShowForegroundNotification={(data) => data.channelId !== activeChannelId}
    >
      <Stack />
    </NotificationProvider>
  );
}
```

### `NotificationProviderProps`

| Prop | Default | Behavior |
| --- | --- | --- |
| `requestPermissionDelay` | `-1` | ms to wait after mount before auto-requesting permission. `0` = immediately, **`-1` = never** |
| `onTokenRegistered(token, platform)` | — | fired once a push token is obtained. This is your hook into the backend |
| `onNotificationTap(event)` | — | fired on tap. `event` is `{ deepLink?, data, id }` |
| `projectId` | `Constants.expoConfig.extra.eas.projectId` | EAS project id for `getExpoPushTokenAsync` |
| `showForegroundNotifications` | `true` | master switch for alert/sound while the app is foregrounded |
| `shouldShowForegroundNotification(data)` | — | per-notification filter. Returning `false` suppresses alert and sound; the notification still lands in the notification center |

> **⚠️ The default `requestPermissionDelay` is `-1`, which means the provider never asks for
> permission and therefore never obtains a token.** Out of the box a fresh install registers
> nothing. Either set a delay (a few seconds after mount, so the OS prompt lands in context
> rather than on first paint) or drive it yourself — but see the next warning before you
> choose the manual route.

> **⚠️ Calling `requestPermission()` from `useNotificationPermission()` grants permission but
> does NOT fetch or register a push token.** Token registration happens in exactly two
> places: the provider's init path, when permission is *already* granted, and the
> `requestPermissionDelay` timer after it grants. So a manual-prompt flow gets a token only
> on the **next app launch**. If you want a custom prompt moment, use
> `requestPermissionDelay` and control when the provider mounts instead.

## API

### `@supa-media/notifications/providers`

`NotificationProvider`, and the `NotificationProviderProps` type.

### `@supa-media/notifications/hooks`

All three must be called inside the provider; each throws a descriptive error otherwise.

| Hook | Returns |
| --- | --- |
| `useNotifications()` | `{ lastNotification, isReady }` — `lastNotification` is the most recent *foreground* notification as `{ id, title, body, data }` |
| `useNotificationPermission()` | `{ status, requestPermission }` — status is `"granted" \| "denied" \| "undetermined"` |
| `usePushToken()` | `{ token, isRegistered }` — `isRegistered` means `onTokenRegistered` was invoked, not that your backend acknowledged it |

### `@supa-media/notifications/handlers`

```ts
registerBackgroundHandler(handler?: (notification: unknown) => void): void
resolveDeepLink(deepLink: string): string
```

`registerBackgroundHandler()` goes at the **top level of your entry file, outside any
component** — it registers the `BACKGROUND_NOTIFICATION_TASK` and installs a
show-everything notification handler.

`resolveDeepLink` reduces any of these to a router-ready path:

| Input | Output |
| --- | --- |
| `/groups/123` | `/groups/123` (passthrough) |
| `https://app.example.com/groups/123?tab=x` | `/groups/123?tab=x` |
| `myapp://groups/123` | `/groups/123` |
| unparseable | the input, prefixed with `/` |

The provider applies it automatically before calling `onNotificationTap`, reading the raw
link from `data.url ?? data.deepLink`. Export it directly only if you also resolve links
from somewhere else (a share sheet, a universal link).

> **⚠️ `registerBackgroundHandler` calls `setNotificationHandler` with "always show".** The
> provider's own effect calls `setNotificationHandler` too — there is one global handler, and
> last writer wins. Calling `registerBackgroundHandler` at module scope (as documented) is
> fine: the provider's effect runs later and takes over. Calling it *after* mount silently
> disables `showForegroundNotifications` and `shouldShowForegroundNotification`.

### `@supa-media/notifications/config`

```ts
DEFAULT_ANDROID_CHANNELS: AndroidNotificationChannel[]
setupAndroidChannels(channels?: AndroidNotificationChannel[]): Promise<void>
```

The defaults are `default` (General, importance 3), `messages` (importance 4), `reminders`
(importance 3, no badge), and `updates` (importance 2, no vibration). `setupAndroidChannels`
is a no-op off Android and safe to call anywhere.

> **⚠️ The provider registers `DEFAULT_ANDROID_CHANNELS` during init and takes no channels
> prop.** To ship your own set, call `setupAndroidChannels(mine)` yourself — but the four
> defaults will already exist on the device, and Android channels cannot be renamed or
> re-configured once created. Use your own channel ids if you don't want the defaults'
> behavior.

### `@supa-media/notifications/types`

`NotificationPayload`, `NotificationData`, `NotificationTapEvent`,
`NotificationProviderConfig`, `PermissionStatus`, `UseNotificationsResult`,
`UseNotificationPermissionResult`, `UsePushTokenResult`, `AndroidNotificationChannel`.
All type-only, all re-exported from the root entry.

## What you must build on the backend

A token that nothing stores is useless. `onTokenRegistered` is the seam; here is the other
side of it, from [`@supa-media/convex`](https://github.com/Supa-Media/supa-framework/tree/main/packages/convex):

**1. Tables** — `supaNotificationTables` supplies `pushTokens` (`userId`, `token`,
`platform`, indexed `by_userId` and `by_token`) and `notificationQueue`:

```ts
import { defineSchema } from "convex/server";
import { supaAuthTables, supaNotificationTables } from "@supa-media/convex/schema";

export default defineSchema({ ...supaAuthTables, ...supaNotificationTables });
```

**2. A `registerPushToken` mutation** wrapping the helper of the same name from
`@supa-media/convex/notifications` — it upserts by token and reassigns the row when a
device changes hands, so it is safe to call on every launch. Note the naming collision if
your Convex functions authenticate by token argument: the auth JWT and the push token are
both "token". Togather's equivalent mutation names them `authToken` and `token`.

**3. Sending.** Also plain async functions you wrap yourself:

| Helper | Use |
| --- | --- |
| `sendNotificationToUser(ctx, payload)` | fans out to every token for a user |
| `sendPushNotification(messages)` | raw Expo Push API call (action context — needs network) |
| `enqueueNotification(ctx, payload)` | writes a `pending` row for later |
| `processNotificationQueue(ctx, batchSize?)` | drains the queue; run it from a cron |
| `cleanupExpiredTokens(ctx, invalidTokens)` | delete tokens after a `DeviceNotRegistered` receipt |

`sendNotificationToUser` puts your `deepLink` inside the push payload's `data`, which is
exactly where the provider looks for it — server `deepLink` in, `event.deepLink` out.

> **⚠️ Nothing prunes dead tokens automatically.** `sendPushNotification` returns Expo's
> tickets and the framework does not inspect them. Read the tickets, collect the tokens that
> came back `DeviceNotRegistered`, and pass them to `cleanupExpiredTokens` — otherwise every
> send fans out to an ever-growing set of dead tokens.

## Platform behavior

- **Web** — `isNativeAvailable()` is false; the provider sets `isReady: true`, leaves
  permission `"undetermined"` until asked (then `"denied"`), and registers no listeners.
- **Simulators / emulators** — `requestPermission()` warns that a physical device is
  required and sets `"denied"`. There is no way to test the real token path in a simulator.
- **Cold start from a tap** — read via `getLastNotificationResponseAsync()`, then
  `onNotificationTap` fires after a **500 ms delay** so navigation is mounted. Handled ids
  are deduplicated against the live response listener, so one tap never navigates twice.

## Test coverage

One test: `__tests__/esm-resolution.test.js`, which walks the built `dist/` output and
asserts every relative ESM specifier resolves under Node's strict rules (the 1.0.1 CHANGELOG
explains why that bug class is invisible to `tsc`). There are **no behavioural tests** —
nothing covers the permission state machine, token registration, cold-start dedup, or channel
setup, and none of it runs in CI without a device. Verify push end-to-end on real hardware.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework. MIT.
