# @supa-media/core

**The client-side runtime for a Convex + Expo app: the auth-wired Convex
provider, an OTA update loop, network and keyboard context, an error boundary,
a tab bar, a modal wrapper, a keyboard-aware form container, and the
`supa.config.ts` types.** It is for React Native / Expo apps (Expo Router
included) that talk to a Convex backend through `@convex-dev/auth` — the
frontend half of what [`@supa-media/convex`](https://github.com/Supa-Media/supa-framework/tree/main/packages/convex) does on the server.

Everything here is small and deliberately unclever. The value is not the
components; it is that the five or six startup papercuts every Expo + Convex app
hits — token storage that differs per platform, a missing `EXPO_PUBLIC_*` var
that crashes opaquely in production, an OTA update that reloads under the user's
thumb, an OAuth `?code=` that silently signs people out — are already handled,
with the reasoning written down beside the code.

## Install

```
pnpm add @supa-media/core
```

### Peer dependencies

Install these yourself. The **Required** ones are needed no matter which subpath
you import; the rest are pulled in only by a specific module — but see the
[barrel warning](#-optional-peers-are-not-optional-if-you-import-a-barrel)
before assuming you can skip one.

| Peer | Range | Needed for |
| --- | --- | --- |
| `react` | `>=19.0.0` | Required |
| `react-native` | `>=0.81.0` | Required |
| `react-native-safe-area-context` | `>=5.6.0` | Required — every layout component calls `useSafeAreaInsets()` |
| `convex` | `>=1.31.0` | Required |
| `@convex-dev/auth` | `>=0.0.90` | Required |
| `expo` | `>=54.0.0` | Required |
| `expo-secure-store` | `>=15.0.0` | `SupaConvexProvider` (native token storage) |
| `expo-updates` | `>=29.0.0` | `OTAUpdateProvider` |
| `@react-native-community/netinfo` | `>=11.4.0` | `NetworkProvider` |
| `react-native-keyboard-controller` | `>=1.20.0` | `KeyboardAwareFormContainer` |
| `@react-navigation/bottom-tabs` | `>=7.0.0` | `SupaTabBar` — **type-only**, genuinely optional at runtime |

The last five are marked `optional` in `peerDependenciesMeta`, so pnpm will not
nag you. Four of them are still *statically imported* by the module that uses
them.

## Subpaths

The package ships compiled ESM (`dist/`) with `.d.ts` alongside. `main` is
`dist/index.js`; `src/` is published too, for reading, not for importing.

| Subpath | Exports |
| --- | --- |
| `.` | Everything below, re-exported |
| `@supa-media/core/providers` | `SupaConvexProvider`, `OTAUpdateProvider`, `ErrorBoundary`, `KeyboardProvider`, `NetworkProvider` (+ `useOTAStatus`, `useNetworkStatus`, `useKeyboardAware`) |
| `@supa-media/core/hooks` | `useOTAStatus`, `useNetworkStatus`, `useKeyboardAware` |
| `@supa-media/core/navigation` | `SupaModal`, `SupaTabBar` |
| `@supa-media/core/forms` | `KeyboardAwareFormContainer` |
| `@supa-media/core/config` | `defineConfig`, `loadConfig`, and the `SupaConfig` type tree |

Prefer the subpaths over `.`. See the barrel warning below for why.

## Providers

### `SupaConvexProvider`

```ts
function SupaConvexProvider(props: {
  children: ReactNode;
  url?: string;
  storage?: TokenStorage;              // from @convex-dev/auth/react
  shouldHandleCode?: boolean | (() => boolean);
}): JSX.Element
```

Creates (and memoises, at module scope, keyed on URL) a `ConvexReactClient` and
wraps it in `ConvexAuthProvider` with platform-aware token storage —
`expo-secure-store` on native, `localStorage` on web. On web it also strips the
`code` query param after a magic-link callback using
`window.history.replaceState`, deliberately **not** `router.replace`, which
throws "Attempted to navigate before mounting the Root Layout".

The real call site is the scaffold's root layout
(`packages/create-supa-app/templates/apps/mobile/app/_layout.tsx`):

```tsx
import { Slot } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SupaConvexProvider } from "@supa-media/core/providers";

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <SafeAreaProvider>
        <SupaConvexProvider url={process.env.EXPO_PUBLIC_CONVEX_URL}>
          <Slot />
        </SupaConvexProvider>
      </SafeAreaProvider>
    </KeyboardProvider>
  );
}
```

> **⚠️ Pass `url` explicitly. Do not rely on the env fallback.**
> The provider falls back to `process.env.EXPO_PUBLIC_CONVEX_URL`, but Expo
> inlines `EXPO_PUBLIC_*` at build/export time **in your app code only — not
> inside `node_modules`**, which is where this package lives. The fallback works
> in some setups and silently doesn't in others. Read the var in your own file
> and hand it over.
>
> When no URL resolves, the provider throws in `__DEV__` (red box) and renders a
> full-screen "Configuration error" panel in production instead. That asymmetry
> is on purpose: an unhandled throw at startup gets swallowed by `expo-updates`'
> ErrorRecovery into an opaque native `SIGABRT`, and you would never learn the
> var was missing from `eas build` / `eas update`.

> **⚠️ `shouldHandleCode` — leave it unset only if your app has no other OAuth
> callback.**
> Unset, `ConvexAuthProvider` treats **every** `?code=` URL parameter on **every**
> route as a sign-in code to redeem. If anything else in your app completes an
> OAuth flow — connecting Dropbox, Google, GitHub — the redirect comes back with
> `?code=<their code>`, the auth provider redeems it as a login code,
> verification returns `tokens: null`, and the client **stores the sign-out**.
> A working session is wiped, deterministically, every time the user connects
> that integration. Found live on context.lc, 2026-08-28.
>
> ```tsx
> <SupaConvexProvider
>   url={process.env.EXPO_PUBLIC_CONVEX_URL}
>   shouldHandleCode={() => !window.location.pathname.startsWith("/connect/")}
> >
> ```
>
> The prop is forwarded verbatim to `ConvexAuthProvider`. A structural test
> (`__tests__/should-handle-code.test.js`) pins that it reaches the element and
> is not merely accepted into the props interface.

### `OTAUpdateProvider`

```ts
function OTAUpdateProvider(props: {
  children: ReactNode;
  onError?: (error: Error) => void;
}): JSX.Element

type OTAStatus = "idle" | "checking" | "downloading" | "ready" | "error";
const { status, checkForUpdates } = useOTAStatus();
```

Non-blocking: children render immediately and the check runs in the background.
Skipped entirely under `__DEV__`. The download is capped at 60s, and a failed
download is non-fatal — the user keeps the version they have.

The applying strategy is the interesting part. Once an update is `ready`, the
provider waits for the app to be **backgrounded for 30+ seconds**, then calls
`Updates.reloadAsync()` on the next foreground, so a reload never happens under
the user's thumb mid-task. It compares wall-clock timestamps rather than running
a timer, because JS timers are suspended while backgrounded on iOS and Android.

Expected-condition errors (`ERR_NOT_COMPATIBLE`, `ERR_UPDATES_DISABLED`,
`ERR_UPDATES_NOT_INITIALIZED`, and "not supported" / "Updates is not enabled"
messages) are swallowed to `idle` and never reach `onError`. Everything else
surfaces via `onError` and shows `status === "error"` for 5 seconds.

### `NetworkProvider`

```ts
function NetworkProvider(props: { children: ReactNode }): JSX.Element

interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  connectionType: string;   // "wifi" | "cellular" | ... from NetInfo
  isInitializing: boolean;
}
const { isConnected } = useNetworkStatus();
```

Wraps `@react-native-community/netinfo`. **Disconnection is debounced by 2
seconds; reconnection is immediate.** That asymmetry keeps an offline banner from
flickering on every momentary blip while still clearing instantly. The default
context value is optimistic (`isConnected: true`) with `isInitializing: true`, so
you can render normally before the first NetInfo event arrives.

### `KeyboardProvider`

```ts
function KeyboardProvider(props: { children: ReactNode }): JSX.Element

interface KeyboardState {
  keyboardHeight: number;   // 0 when hidden
  keyboardVisible: boolean;
  bottomInset: number;      // max(keyboard, safe area) — use this for padding
}
const { bottomInset } = useKeyboardAware();
```

Must be rendered inside a `SafeAreaProvider`. Listens to `keyboardWillShow`/
`Hide` on iOS and `keyboardDidShow`/`Hide` on Android, and subtracts the safe
area inset from the iOS height (which already includes it) so you do not
double-pad the home indicator. `bottomInset` is the value you actually want in a
style.

> **⚠️ Two different things are called `KeyboardProvider`.**
> This one, and the one from `react-native-keyboard-controller`. They are not
> interchangeable: `KeyboardAwareFormContainer` needs
> *keyboard-controller's* provider at the app root, while `useKeyboardAware()`
> reads *this* one's context. The scaffold mounts keyboard-controller's. If you
> want both, mount both, and import each by an alias so the next reader can tell
> which is which.

### `ErrorBoundary`

```ts
class ErrorBoundary extends Component<{
  children: ReactNode;
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}>
```

A plain render-error boundary with a styled default fallback and a Try Again
button that clears the error state. `onError` is where you hang Sentry:

```tsx
<ErrorBoundary onError={(error) => Sentry.captureException(error)}>
  <App />
</ErrorBoundary>
```

## Navigation

### `SupaTabBar`

A drop-in `tabBar` for `@react-navigation/bottom-tabs`. Takes the standard
`BottomTabBarProps` plus `style`, `activeTintColor` (default `#1a1a1a`) and
`inactiveTintColor` (default `#9ca3af`). It handles the safe-area bottom inset,
**dismisses the keyboard on every tab press**, honours `tabPress`
`preventDefault`, and renders `options.tabBarBadge` (clamped to `99+`).

```tsx
<Tab.Navigator tabBar={(props) => <SupaTabBar {...props} />}>
  <Tab.Screen name="Home" component={HomeScreen} />
</Tab.Navigator>
```

### `SupaModal`

```ts
function SupaModal(props: {
  children: ReactNode;
  onDismiss: () => void;
  fullScreen?: boolean;          // default false → bottom sheet with a grab handle
  dismissOnBackdrop?: boolean;   // default true
  contentStyle?: StyleProp<ViewStyle>;
  backdropOpacity?: number;      // default 0.5
}): JSX.Element
```

This is **not** a React Native `<Modal>`. It is the content wrapper you put
*inside* a modal screen — an Expo Router modal route, say — providing the
backdrop, the keyboard avoidance (`padding` on iOS, `height` on Android) and the
safe-area padding:

```tsx
// app/modal.tsx
import { SupaModal } from "@supa-media/core/navigation";
import { router } from "expo-router";

export default function MyModal() {
  return (
    <SupaModal onDismiss={() => router.back()}>
      <Text>Modal content here</Text>
    </SupaModal>
  );
}
```

## Forms

### `KeyboardAwareFormContainer`

```ts
function KeyboardAwareFormContainer(props: {
  children: ReactNode;
  keyboardVerticalOffset?: number;   // default 24
  scrollable?: boolean;              // default true
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  safeAreaBottom?: boolean;          // default true
}): JSX.Element
```

Built on `react-native-keyboard-controller` rather than React Native's
`KeyboardAvoidingView`, because the latter's behaviour differs enough between
platforms to be a permanent source of bug reports. The focused input is scrolled
above the keyboard on both iOS and Android.

`scrollable={false}` swaps the scroll view for keyboard-controller's
`KeyboardAvoidingView` — use it when your content already owns a
`ScrollView`/`FlatList`, since nesting two scrollers is its own bug.

```tsx
<KeyboardAwareFormContainer keyboardVerticalOffset={80}>
  <TextInput placeholder="Title" />
  <TextInput placeholder="Body" multiline />
  <Button title="Submit" />
</KeyboardAwareFormContainer>
```

Requires keyboard-controller's `<KeyboardProvider>` at the app root.

## Config

```ts
import { defineConfig, loadConfig, type SupaConfig } from "@supa-media/core/config";

// supa.config.ts
export default defineConfig({
  app: { name: "MyApp" },
  auth: { method: "phone-otp" },
  tenancy: { enabled: true },
});
```

`defineConfig` returns its argument unchanged — it exists purely so the config
site gets autocompletion and type errors. `loadConfig(path?)` dynamically
imports `supa.config` from `process.cwd()` (or the path you give) and validates
that `app.name` and `auth.method` are present; a missing file is rethrown as a
readable "Could not find supa.config.ts" error. It is **for CLI tools and build
scripts, not for app runtime** — it touches `process.cwd()`.

`SupaConfig` is a tree of interfaces you can import individually: `AuthConfig`,
`TenancyConfig`, `MobileConfig`, `FeaturesConfig` (open-ended — extra boolean
keys are allowed), `BuildConfig`, `SecretsConfig`, `DeployConfig`,
`PaymentsConfig`, `DevConfig`, `SharedConfig`, `ConvexConfig`.

> **⚠️ The `create-supa-app` scaffold currently emits a `supa.config.ts` whose
> shape does not match `SupaConfig`** (it writes `app.slug`, `multiTenant`,
> `deployment`, `infrastructure`). Treat the types in this package as the
> authority for what `loadConfig` validates, and expect to reconcile the two if
> you scaffold and then typecheck the config file.

## Gotchas

### ⚠️ Optional peers are not optional if you import a barrel

`@supa-media/core/providers` re-exports all five providers from one module, so
importing *anything* from it loads `expo-secure-store`, `expo-updates` and
`@react-native-community/netinfo`. Importing the root `.` additionally loads
`react-native-keyboard-controller` (via `./forms`). Metro does not tree-shake
these away.

Practically: if you want `ErrorBoundary` and nothing else, you still need those
three packages installed. Install all the optional peers, or accept that adding
one provider means adding its dependency.

The reverse also bites: **do not import `@supa-media/core` (root) from a Node
script** to reach `loadConfig` — you will drag `react-native` into a Node
process. Import `@supa-media/core/config`.

### ⚠️ Relative specifiers in `dist/` must keep their `.js`

`tsc` never rewrites relative import specifiers at emit time, and this repo
compiles with `moduleResolution: "bundler"`, which happily accepts
extension-less relative imports in source. Emitted verbatim into `dist/*.js`,
those break Node's strict ESM resolution the moment a real Node process loads
the built output — exactly what happens when a consumer's `supa.config.ts` is
loaded through `tsx/cjs`. It is invisible to `tsc`, to typecheck, and to the JS
bundle. This shipped once and was fixed in 1.0.1; `__tests__/esm-resolution.test.js`
now re-runs Node's resolution algorithm over `dist/` and fails the build if any
specifier loses its extension. If you contribute here, write `./foo.js`, not
`./foo`.

### Everything layout-shaped needs `SafeAreaProvider`

`KeyboardProvider`, `SupaModal`, `SupaTabBar` and `KeyboardAwareFormContainer`
all call `useSafeAreaInsets()`. Mount `SafeAreaProvider` above them.

## Maturity and test coverage

Be clear-eyed about this. The package has **three test files, and none of them
render a component** — the suite is `node --test` with no DOM or React Native
renderer:

| Test | What it actually proves |
| --- | --- |
| `esm-resolution.test.js` | Every relative specifier in `dist/` resolves under strict Node ESM |
| `config-subpath.test.js` | A real `import()` of the built `./config` entry point loads and exposes `defineConfig` / `loadConfig` |
| `should-handle-code.test.js` | `shouldHandleCode` survives into the built provider and is forwarded, not just destructured |

So: the build output and the one known-destructive regression are pinned. The
behaviour of the providers, hooks and components is **not** covered by tests in
this package — it is exercised in the consuming apps. The behavioural pin for
`shouldHandleCode` lives in context.lc's layout test, where a DOM exists.

Run the suite with `pnpm test` (it builds first — the tests read `dist/`).

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework

MIT licensed.
