# Supa Framework — Design Document v3

## Context

Togather and Fount Studios are two production Expo + Convex apps built on nearly identical infrastructure. Both duplicate ~60% of scaffolding, CI/CD, and provider plumbing, plus hard-won solutions to Expo/React Native gotchas (keyboard handling, navigation modals, chat virtualization, OTA-safe native gating, file structure enforcement). Every new app re-encounters these same pitfalls.

**Goal**: Build **Supa** — an opinionated full-stack application framework for Convex + Expo apps. A developer should be able to spawn a new app in ~2 minutes with auth, multi-tenancy, chat, navigation, keyboard handling, CI/CD, and secrets all wired up. They focus on domain logic and UI skin; Supa handles everything else.

**Non-goals**: Supa is not a design system. It does not dictate colors, fonts, layouts, or component aesthetics. Apps own their entire visual layer.

**Company**: Supa Media
**Repo**: `github.com/Supa-Media/supa-framework`

---

## What Supa Provides

### Layer 1: Infrastructure (invisible plumbing)
- Monorepo scaffolding (pnpm + Turborepo)
- CI/CD pipelines (GitHub Actions reusable workflows)
- Secret management (opinionated 1Password flow)
- OTA updates with native fingerprinting
- Native capability gating + enforcement
- Dev server orchestration
- Metro config for pnpm monorepos

### Layer 2: Backend Patterns (Convex)
- OTP auth (phone via Twilio + email via Resend) — the only auth provider
- Multi-tenancy schema (optional, scaffolded if requested)
- User table with sensible defaults
- Auth helpers (`requireAuth`, `getOptionalAuth`)
- Secret syncing to Convex
- Cron job patterns

### Layer 3: App Shell (structural, not visual)
- Provider stack (Convex, OTA, SafeArea, ErrorBoundary, Keyboard, Network)
- Bottom tab navigation structure (scaffolded, consumer customizes tabs)
- Keyboard-aware form handling (no more inputs hidden behind keyboards)
- Modal/bottom sheet navigation patterns (with gotcha handling)
- File structure enforcement (linting + tests for Expo Router conventions)
- Platform-specific file conventions (.web.ts, .native.ts)

### Layer 4: Feature Modules (opt-in during setup)
- **`@supa-media/notifications`** — Push notifications with Firebase/APNs config, deep linking, rich notifications (images, actions), token management, permission flows
- **`@supa-media/chat`** — Real-time messaging with pagination, virtual scrolling, offline caching, and pluggable data sources
- **`@supa-media/payments`** — Stripe integration with staging/production key separation, subscription management, webhook handling
- *(Future: maps, file uploads, etc.)*

### Layer 5: Release & Update Management
- Configurable deployment strictness (from "push-to-prod" to "branch → staging → promote")
- Semver with clear breaking/minor/patch classification
- Bulk update story (one `pnpm update @supa-media/*` across 10 apps)

---

## Package Architecture

```
supa-framework/                         (monorepo)
├── packages/
│   ├── core/                           @supa-media/core
│   │   ├── providers/                  ConvexProvider, OTAProvider, ErrorBoundary,
│   │   │                               KeyboardProvider, NetworkProvider, SafeAreaProvider
│   │   ├── hooks/                      useAuth, useOTAStatus, useNetworkStatus,
│   │   │                               useKeyboardAware, useTenant
│   │   ├── navigation/                 Modal, BottomSheet, navigation helpers,
│   │   │                               type-safe route params
│   │   ├── forms/                      KeyboardAwareScrollView, FormContainer,
│   │   │                               keyboard avoidance utilities
│   │   └── config/                     defineConfig, config reader
│   │
│   ├── chat/                           @supa-media/chat
│   │   ├── components/                 MessageList (inverted FlatList + pagination),
│   │   │                               MessageInput (keyboard-aware), MessageBubble
│   │   ├── hooks/                      useMessages (pagination + live subscription),
│   │   │                               useChannels, useUnreadCount
│   │   ├── stores/                     messageCache (Zustand + AsyncStorage),
│   │   │                               channelCache, offline queue
│   │   ├── adapters/                   ConvexChatAdapter (default), ChatAdapter interface
│   │   └── types/                      Message, Channel, ChatConfig
│   │
│   ├── notifications/                  @supa-media/notifications
│   │   ├── providers/                  NotificationProvider (permission flow,
│   │   │                               token registration, deep link routing)
│   │   ├── config/                     Firebase setup, APNs config, channel defs
│   │   ├── hooks/                      useNotifications, useNotificationPermission,
│   │   │                               usePushToken
│   │   ├── types/                      NotificationPayload (title, body, image,
│   │   │                               deepLink, data, badge, sound)
│   │   └── handlers/                   Background handler, tap handler,
│   │                                   deep link resolver
│   │
│   ├── payments/                       @supa-media/payments
│   │   ├── config/                     Stripe key management (staging vs prod),
│   │   │                               product/price definitions
│   │   ├── hooks/                      useSubscription, usePaymentSheet,
│   │   │                               useProducts
│   │   ├── convex/                     Webhook handler, customer management,
│   │   │                               subscription state queries
│   │   └── components/                 PaywallGate, SubscriptionStatus
│   │
│   ├── convex/                         @supa-media/convex
│   │   ├── auth/                       OTP auth setup (Twilio + Resend),
│   │   │                               requireAuth, getOptionalAuth helpers
│   │   ├── schema/                     Base tables (users, tenants, auth),
│   │   │                               multi-tenancy helpers
│   │   ├── chat/                       Chat schema tables, message queries/mutations
│   │   │                               (consumed by @supa-media/chat's ConvexChatAdapter)
│   │   ├── notifications/              Push token storage, notification queue,
│   │   │                               send helpers (Expo Push API)
│   │   ├── payments/                   Stripe webhook handler, subscription tables,
│   │   │                               customer management
│   │   └── lib/                        Rate limiting, validation, scheduling utils
│   │
│   ├── metro/                          @supa-media/metro
│   │   └── createMetroConfig()         pnpm monorepo support, shared package resolution
│   │
│   ├── native-safety/                  @supa-media/native-safety
│   │   ├── check-fingerprint           Native change detection
│   │   ├── check-native-imports        Static import gating enforcement
│   │   └── hasNativeModule()           Runtime capability detection
│   │
│   ├── linter/                         @supa-media/linter
│   │   ├── rules/                      ESLint rules for Supa conventions
│   │   │   ├── no-ungated-native       Enforces native dep gating
│   │   │   ├── route-naming            Expo Router path conventions
│   │   │   ├── platform-file-pairs     .web.ts must exist for native-only modules
│   │   │   └── keyboard-in-forms       Forms must use KeyboardAware wrapper
│   │   └── preset.js                   Shareable ESLint config
│   │
│   ├── testing/                        @supa-media/testing
│   │   ├── routing-conflicts           Detect routes resolving to same URL
│   │   ├── web-bundle-safety           Validate .web counterparts exist
│   │   ├── react-resolution            Ensure correct React version in monorepo
│   │   └── native-import-check         CI-time static analysis
│   │
│   ├── dev/                            @supa-media/dev
│   │   └── dev orchestrator            Convex + Expo together, flags, port mgmt
│   │
│   ├── scripts/                        @supa-media/scripts
│   │   ├── sync-secrets-to-convex      Env var syncing from 1Password
│   │   ├── generate-ota-version        RUNTIME.MMDDYY.HHMM versioning
│   │   └── setup-secrets               Interactive secret setup from 1Password
│   │
│   └── create-supa-app/                create-supa-app (private scaffolder)
│       ├── templates/                  Scaffolded file templates
│       └── prompts/                    Interactive setup questions
│
├── .github/workflows/                  Reusable GitHub Actions
│   ├── ci.yml
│   ├── deploy-convex.yml
│   ├── deploy-mobile-update.yml
│   ├── build-mobile-native.yml
│   └── deploy-web.yml
│
└── docs/
    ├── getting-started.md
    ├── chat-module.md
    ├── multi-tenancy.md
    ├── native-gating.md
    └── conventions.md
```

---

## Opinionated Conventions (Enforced)

Supa is opinionated about how you structure your app. These are enforced via `@supa-media/linter` rules and `@supa-media/testing` test suites.

### File Structure
```
my-app/
  apps/
    mobile/
      app/                    # Expo Router routes ONLY (no business logic)
        (auth)/               # Auth screens
        (app)/                # Authenticated app
          (tabs)/             # Tab navigation
        _layout.tsx           # Root layout (thin — imports from @supa-media/core)
      features/               # Feature modules (all business logic lives here)
        my-feature/
          components/         # Feature-specific components
          hooks/              # Feature-specific hooks
          screens/            # Screen components (imported by routes)
          utils/              # Feature utilities
          types/              # Feature types
      components/             # Shared UI components
      providers/              # App-specific providers only
      hooks/                  # Shared hooks
      stores/                 # Zustand stores
    convex/
      functions/              # Organized by domain
      lib/                    # Shared backend utilities
      schema.ts
      auth.ts
  packages/
    shared/                   # Types + utils shared across apps
```

### Route Naming Rules (enforced by linter + tests)
- Route files in `app/` are thin — they import screens from `features/`
- No business logic in route files
- Route groups `(groupName)` don't affect URLs — tested by routing conflict detector
- Dynamic routes `[param]` must have type-safe param definitions
- Nested layouts must have `_layout.tsx` files (prevents Expo Router crashes)

### Native Dependency Rules (enforced by linter + CI)
- All native deps classified in `native-deps.json` as `core` or `gated`
- `gated` deps MUST use dynamic imports behind `hasNativeModule()` checks
- Static imports of gated deps fail CI
- Safe wrapper components required for gated UI (e.g., `SafeLinearGradient`)

### Platform File Rules (enforced by tests)
- Zustand stores with native-only APIs must have `.web.ts` counterparts
- Native providers must have `.web.tsx` counterparts
- Export signatures must match between `.native` and `.web` files

---

## `@supa-media/chat` — Chat Module (Deep Dive)

The chat module is the first feature module. It provides production-grade messaging that apps can plug into with their own data sources.

### Architecture
```
Consumer App                    @supa-media/chat               @supa-media/convex
     │                              │                              │
     │  <ChatProvider               │                              │
     │    adapter={ConvexChatAdapter}│                              │
     │    config={...}>             │                              │
     │                              │                              │
     │  <MessageList />  ──────────>│ Inverted FlatList            │
     │                              │ Pagination (cursor-based)    │
     │                              │ Date separators              │
     │                              │ Message grouping             │
     │                              │                              │
     │  <MessageInput /> ──────────>│ Keyboard-aware               │
     │                              │ Attachment support           │
     │                              │ Send queue (offline)         │
     │                              │                              │
     │                              │ messageCache ───────────────>│ Convex queries
     │                              │ (Zustand + AsyncStorage)     │ (live subscription
     │                              │ 50 msgs/channel              │  + paginated history)
     │                              │ 24h stale-while-revalidate   │
```

### Pluggable Data Sources
```typescript
// Default: Convex adapter (works out of the box with @supa-media/convex chat schema)
import { ConvexChatAdapter } from '@supa-media/chat/adapters';

// Custom: implement the ChatAdapter interface for any backend
interface ChatAdapter {
  subscribeToMessages(channelId: string, cursor?: string): AsyncIterable<Message[]>;
  sendMessage(channelId: string, content: MessageContent): Promise<void>;
  loadHistory(channelId: string, cursor: string, limit: number): Promise<Message[]>;
  markAsRead(channelId: string, messageId: string): Promise<void>;
  getChannels(): AsyncIterable<Channel[]>;
}
```

### What's Included
- **MessageList**: Inverted FlatList with virtual scrolling, cursor-based pagination, date separators, message grouping by sender, scroll-to-bottom button
- **MessageInput**: Keyboard-aware input bar, stays above keyboard on all platforms, attachment support, typing indicators
- **Offline Mode**: Zustand + AsyncStorage cache (50 messages per channel, 20 channels, 24h expiry), stale-while-revalidate, offline send queue that flushes on reconnect
- **Unread Counts**: Per-channel unread tracking with badge support

### What's NOT Included (app-specific)
- Message bubble styling (apps provide their own `renderMessage` prop)
- Reactions, threads, link previews (app-level features)
- Channel creation UI (domain-specific)

**Source**: Extracted from `togather/apps/mobile/features/chat/` (pagination, caching, keyboard handling) and `togather/apps/mobile/stores/messageCache.ts` (offline pattern).

---

## `@supa-media/notifications` — Push Notifications (Core Module)

Notifications are one of the hardest things to get right in mobile apps. Firebase/APNs config, permission flows, token management, deep linking, background handling — all of this is boilerplate that every app needs. Supa makes it work out of the box.

### What's Included

**Setup (scaffolded by `create-supa-app`):**
- Firebase project configuration (`google-services.json` / `GoogleService-Info.plist`)
- APNs key configuration for iOS
- Expo Push API integration (no raw Firebase SDK needed)
- Notification channels/categories defined in config
- All tokens (Firebase, APNs, Expo Push) managed in `supa.config.ts` and 1Password

**Runtime (`@supa-media/notifications` package):**
- `NotificationProvider` — wraps app, handles:
  - Permission request flow (asks at right time, handles denial gracefully)
  - Push token registration with Convex backend
  - Token refresh on app launch
  - Foreground notification display
  - Background notification handling
  - Tap → deep link resolution (uses Expo Router linking)
- `useNotifications()` — hook for notification state
- `useNotificationPermission()` — permission status + request function
- `usePushToken()` — current push token

**Backend (`@supa-media/convex/notifications`):**
- `pushTokens` table — stores device tokens per user
- `notificationQueue` table — outbound notification queue
- `sendNotification(ctx, { userId, title, body, image?, deepLink?, data? })` — helper
- `sendBulkNotifications()` — batch sending
- Expo Push API integration (handles receipts, retries, token cleanup)
- Cron job for processing notification queue

**Notification Payload Type:**
```typescript
interface NotificationPayload {
  title: string;
  body: string;
  image?: string;           // Rich notification image URL
  deepLink?: string;        // e.g., '/groups/abc123' — resolved by Expo Router
  data?: Record<string, string>;  // Custom data
  badge?: number;
  sound?: string;
  channelId?: string;       // Android notification channel
}
```

### What's NOT Included (app-specific)
- Notification preferences UI (which notifications to receive)
- In-app notification center/feed
- Specific notification triggers (app defines when to send)

**Source**: Extracted from `togather/apps/mobile/providers/NotificationProvider.tsx` and `togather/apps/convex/functions/notifications/`.

---

## `@supa-media/payments` — Stripe Integration

Payments scaffolding with proper staging/production key separation.

### What's Included

**Setup (scaffolded by `create-supa-app`):**
- Stripe publishable + secret keys for staging AND production (stored in 1Password)
- Webhook endpoint in Convex HTTP handler
- Stripe webhook signing secret per environment

**Runtime (`@supa-media/payments` package):**
- `useSubscription()` — current user's subscription status
- `usePaymentSheet()` — Stripe payment sheet integration
- `useProducts()` — available products/prices
- `PaywallGate` — component that conditionally renders based on subscription
- `SubscriptionStatus` — display component for current plan

**Backend (`@supa-media/convex/payments`):**
- `customers` table — Stripe customer mapping
- `subscriptions` table — subscription state
- Webhook handler (checkout.session.completed, invoice.paid, subscription.updated/deleted)
- `createCheckoutSession()` — server-side checkout
- `getSubscriptionStatus()` — query current status
- Customer portal URL generation

### Environment Separation
```typescript
// supa.config.ts
payments: {
  stripe: {
    staging: {
      publishableKey: 'pk_test_...',  // or 1Password ref
      secretKey: 'op://MyApp/stripe-staging/secret-key',
      webhookSecret: 'op://MyApp/stripe-staging/webhook-secret',
    },
    production: {
      publishableKey: 'pk_live_...',
      secretKey: 'op://MyApp/stripe-prod/secret-key',
      webhookSecret: 'op://MyApp/stripe-prod/webhook-secret',
    },
  },
}
```

---

## Keyboard Handling (Framework-Level)

One of the most painful Expo/RN gotchas. Supa handles this at the framework level.

### `KeyboardAwareFormContainer`
Wraps any form page. Ensures:
- Content scrolls when keyboard appears
- Active input field is visible above keyboard
- Works on both iOS (padding behavior) and Android (height behavior)
- Handles nested ScrollViews correctly

```tsx
// Consumer usage — no keyboard headaches
import { KeyboardAwareFormContainer } from '@supa-media/core/forms';

function MyFormScreen() {
  return (
    <KeyboardAwareFormContainer>
      <TextInput label="Name" />
      <TextInput label="Email" />
      <TextInput label="Bio" multiline />
      <Button title="Save" />
    </KeyboardAwareFormContainer>
  );
}
```

### `KeyboardProvider`
In the root layout, provides keyboard state to the entire app:
- Current keyboard height
- Whether keyboard is visible
- Safe bottom inset calculation (keyboard height OR bottom safe area, whichever is larger)

Uses `react-native-keyboard-controller` (core native dep) for accurate keyboard tracking.

### Chat Input Integration
`@supa-media/chat`'s `MessageInput` uses `KeyboardProvider` internally — the input bar rises with the keyboard, content above scrolls up, no overlap ever.

---

## Multi-Tenancy (Optional, Scaffolded)

During `create-supa-app`, the developer is asked: "Is this a multi-tenant app?"

### If yes:
- Schema gets a `tenants` table (name configurable — "communities", "organizations", "workspaces", etc.)
- Users table gets `activeTenantId` field
- `TenantProvider` added to provider stack
- `useTenant()` hook available for current tenant context
- All generated Convex queries include tenant scoping
- Tenant switching UI scaffold generated

### If no:
- No tenant table
- Simpler schema
- No tenant provider

### Scaffolded Schema (multi-tenant mode)
```typescript
// apps/convex/schema.ts (generated)
import { supaAuthTables, supaTenantTables } from '@supa-media/convex/schema';

export default defineSchema({
  ...supaAuthTables,      // users, authAccounts, authSessions, etc.
  ...supaTenantTables({   // tenants + userTenants junction
    tenantName: 'communities',  // customizable table name
    tenantFields: {},           // consumer adds their own fields
  }),
  // Consumer's domain tables below...
});
```

---

## Navigation Patterns

### Bottom Tab Bar
Scaffolded by default. Consumer customizes which tabs and their icons/labels.

```tsx
// Generated (app)/(tabs)/_layout.tsx — consumer edits this
import { SupaTabBar } from '@supa-media/core/navigation';

export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <SupaTabBar {...props} />}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ... }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: ... }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ... }} />
    </Tabs>
  );
}
```

`SupaTabBar` handles: safe area insets, keyboard dismiss on tab switch, badge support. Consumer styles it however they want.

### Modals & Bottom Sheets
Navigation between modal types has known gotchas in Expo Router / React Navigation. Supa provides:

- `SupaModal` — wrapper with keyboard avoidance, consistent dismiss behavior, platform-aware animations
- Navigation helpers for presenting/dismissing modals safely (prevents "Maximum update depth exceeded")
- Route group patterns for modal stacks

---

## Secret Management (Opinionated)

Supa is opinionated: **1Password is the secret store.**

### Setup Flow (`create-supa-app`)
1. Prompts: "Enter your 1Password vault name" → stores in `supa.config.ts`
2. Generates `.env.example` with all required vars and their 1Password paths
3. Generates `scripts/setup-secrets.sh` that pulls from 1Password → `.env.local`
4. Generates `scripts/sync-secrets-to-convex.sh` for CI

### Developer Experience
```bash
# First time setup — pulls all secrets from 1Password
pnpm setup:secrets

# CI — secrets flow automatically via 1Password service account
# (configured in GitHub repo secrets: OP_SERVICE_ACCOUNT_TOKEN)
```

### What's Pre-Configured
- Convex deployment URL + deploy key
- JWT secret
- Twilio credentials (for phone OTP)
- Resend API key (for email OTP)
- EAS/Expo tokens
- Sentry DSN (optional)

Consumer adds their own app-specific secrets to the config.

### Adding New Secrets
When a consumer needs a new secret (e.g., adding a Mapbox integration):
1. Add the key to `supa.config.ts` under `secrets.convexEnvVars`
2. Add the 1Password reference to `.env.example`
3. Run `pnpm setup:secrets` — it pulls the new value from 1Password
4. Push — CI automatically syncs the new secret to Convex

No manual copying, no forgetting to set it in CI. One source of truth.

---

## Deployment Strictness (Configurable)

Different apps need different levels of production protection. A side project shouldn't need the same ceremony as a production SaaS with paying users. Supa supports configurable deployment strictness.

### Levels

```typescript
// supa.config.ts
deploy: {
  // 'relaxed' | 'standard' | 'strict'
  strictness: 'standard',
}
```

**`relaxed`** — For early-stage apps and side projects
- Push to `main` → auto-deploys everything to production (Convex + OTA + web)
- No staging environment
- No manual approval
- CI runs tests but doesn't block deploy on non-critical failures
- Good for: prototypes, personal apps, hackathon projects

**`standard`** — For apps with real users
- Push to `main` → auto-deploys to **staging**
- Production deploy requires manual trigger (`workflow_dispatch`) or promotion command
- CI must pass before merge to main
- Fingerprint check enforced (blocks OTA if native changed)
- Health checks after deploy
- Good for: indie apps, small teams, early startups

**`strict`** — For production SaaS with paying users
- Feature branches → PR → CI must pass → merge to `main`
- Push to `main` → deploys to **staging** only
- Production promotion via explicit command: `pnpm ship:production`
- Requires all CI checks green + manual confirmation
- Canary/phased rollout for OTA updates (e.g., 10% → 50% → 100%)
- Rollback capability (previous OTA version)
- Slack/webhook notifications on deploy
- Good for: production apps, multiple developers, paid products

### Switching Between Levels
As an app matures, change one line in `supa.config.ts`:
```typescript
deploy: { strictness: 'strict' }
```
Push → CI picks up the new reusable workflow parameters automatically.

---

## Update Management (The "React Upgrade" Experience)

### How Framework Updates Work (Next.js Model)

Supa follows the same update model as Next.js, React, and Expo — consumer-driven, not framework-pushed.

When you push a fix to `supa-framework`:

1. **Changesets** publishes new `@supa-media/*` package versions to GitHub Packages with a changelog
2. Consumers update when they're ready: `pnpm update @supa-media/*`
3. CI runs — if tests pass, it's safe to deploy
4. Deploy via the app's normal pipeline (OTA or native build)

No automated PRs, no forced updates. The framework publishes; consumers pull.

### Semver Contract

| Change Type | Version Bump | Consumer Action | Example |
|-------------|-------------|-----------------|---------|
| **Patch** | `1.2.3` → `1.2.4` | None — just update | Bug fix in OTAProvider, better keyboard handling |
| **Minor** | `1.2.3` → `1.3.0` | None — just update | New `useNotificationPermission` hook, new lint rule |
| **Major** | `1.x` → `2.0.0` | Migration required | Auth API change, provider stack restructure |

### Breaking Change Policy
- Major versions ship with a **migration guide** and optional **codemod**:
  ```bash
  npx @supa-media/codemods v2-auth-migration
  ```
- Previous major version gets security patches for 6 months
- Breaking changes are batched (no frequent majors)

### Changelog & Visibility
Each `@supa-media/*` package has its own `CHANGELOG.md`. The framework repo also maintains a unified changelog showing what changed across all packages in each release.

---

## Configuration: `supa.config.ts`

```typescript
import { defineConfig } from '@supa-media/core/config';

export default defineConfig({
  // App identity
  app: {
    name: 'My App',
    slug: 'my-app',
    scheme: 'myapp',
  },

  // Backend
  convex: {
    functionsDir: 'apps/convex',
  },

  // Auth (OTP only)
  auth: {
    providers: ['phone', 'email'],  // phone = Twilio, email = Resend
    // Future: could add 'oauth' here
  },

  // Multi-tenancy
  tenancy: {
    enabled: true,
    tableName: 'communities',  // or 'organizations', 'workspaces', etc.
  },

  // Mobile
  mobile: {
    dir: 'apps/mobile',
    bundleId: {
      production: 'com.myapp.mobile',
      staging: 'com.myapp.staging',
    },
    easProjectId: '...',
  },

  // Feature modules
  features: {
    notifications: true,  // @supa-media/notifications + push token tables + Expo Push
    chat: true,           // @supa-media/chat + message/channel tables
    payments: true,       // @supa-media/payments + Stripe integration
  },

  // Build
  build: {
    nodeVersion: '22',
    pnpmVersion: '9',
  },

  // Secrets
  secrets: {
    provider: 'onepassword',
    vault: 'My App',
    convexEnvVars: [
      'RESEND_API_KEY',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER',
      'TWILIO_VERIFY_SERVICE_SID',
      // ...consumer adds their own
    ],
  },

  // Deployment
  deploy: {
    strictness: 'standard',  // 'relaxed' | 'standard' | 'strict'
  },

  // Payments (if enabled)
  payments: {
    stripe: {
      staging: {
        publishableKey: 'op://MyApp/stripe-staging/publishable-key',
        secretKey: 'op://MyApp/stripe-staging/secret-key',
        webhookSecret: 'op://MyApp/stripe-staging/webhook-secret',
      },
      production: {
        publishableKey: 'op://MyApp/stripe-prod/publishable-key',
        secretKey: 'op://MyApp/stripe-prod/secret-key',
        webhookSecret: 'op://MyApp/stripe-prod/webhook-secret',
      },
    },
  },

  // Dev
  dev: {
    metroPort: 8081,
  },

  // Shared package
  shared: {
    name: '@myapp/shared',
    dir: 'packages/shared',
  },
});
```

---

## CI/CD (Reusable GitHub Workflows)

Consumer CI files are thin wrappers (~15 lines each):

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  ci:
    uses: Supa-Media/supa-framework/.github/workflows/ci.yml@v1
    with:
      node-version: "22"
      shared-package: "@myapp/shared"
      has-chat: true
      has-e2e: false
    secrets: inherit
```

The reusable workflows handle:
- **ci.yml**: Change detection, typecheck, lint (with Supa rules), test (with Supa test suites), native safety checks
- **deploy-convex.yml**: Secret sync from 1Password → Convex, deploy functions
- **deploy-mobile-update.yml**: Fingerprint check → OTA publish (or block if native changed)
- **build-mobile-native.yml**: EAS native build with fingerprint detection
- **deploy-web.yml**: Web export + deployment (EAS Hosting)

---

## Update Flow

### Framework JS update → consumer OTA
1. Fix pushed to `supa-framework` → changesets publishes `@supa-media/chat@1.2.1`
2. Consumer: `pnpm update @supa-media/*` → lockfile updates
3. Push to main → CI fingerprint passes → OTA published → users get update in background

### Framework native dep update
1. `@supa-media/core` adds new native dep → consumer fingerprint check fails
2. CI blocks OTA → triggers native build workflow
3. Consumer submits to stores → subsequent JS changes are OTA again

### CI/CD update
1. Reusable workflow updated → tagged `v1.x.y`
2. Consumer apps pinned to `@v1` get it automatically on next CI run

---

## `create-supa-app` — The 2-Minute Setup

```bash
# Clone the framework and run the scaffolder locally
git clone https://github.com/Supa-Media/supa-framework.git
cd supa-framework
pnpm install
node packages/create-supa-app/src/index.js my-app
```

### Interactive Prompts
```
── App Identity ──
? App name: My App
? App slug: my-app
? URL scheme (for deep links): myapp
? Bundle ID (production): com.myapp.mobile
? Bundle ID (staging): com.myapp.staging

── Architecture ──
? Is this a multi-tenant app? (e.g., SaaS with multiple orgs) Yes
? What are tenants called? (e.g., communities, organizations): organizations

── Auth ──
? Auth providers: [x] Phone OTP (Twilio)  [x] Email OTP (Resend)
? Twilio Account SID: (paste or 1Password ref)
? Twilio Auth Token: (paste or 1Password ref)
? Twilio Phone Number: +1...
? Twilio Verify Service SID: VA...
? Resend API Key: (paste or 1Password ref)

── Features ──
? Enable push notifications? Yes
? Enable chat module? Yes
? Enable payments (Stripe)? Yes
? Stripe publishable key (staging): pk_test_...
? Stripe secret key (staging): (1Password ref)
? Stripe publishable key (production): pk_live_...
? Stripe secret key (production): (1Password ref)

── Deployment ──
? Deployment strictness:
  ○ Relaxed — push to main deploys to production (side projects)
  ● Standard — push to main deploys to staging, manual promote to prod
  ○ Strict — feature branches, staging, manual promote, canary rollout

── Infrastructure ──
? 1Password vault name: My App
? EAS Project ID: (paste from expo.dev)
? Expo owner: my-org
? Convex deployment name (dev): (auto-generated or paste)

── Notifications (if enabled) ──
? Firebase project ID: my-app-12345
? APNs key ID: ABC123
? APNs team ID: XYZ789
```

All secrets are stored as 1Password references in the config. The setup script validates connectivity to each service.

### What Gets Generated
- Full monorepo structure (see File Structure section above)
- `supa.config.ts` with all answers filled in
- `apps/convex/schema.ts` with users + tenants + notifications + chat + payments tables (based on selections)
- `apps/convex/auth.ts` with OTP configured
- `apps/convex/http.ts` with Stripe webhook endpoint (if payments enabled)
- `apps/mobile/app/_layout.tsx` composing Supa provider stack (NotificationProvider, etc.)
- `apps/mobile/app/(tabs)/_layout.tsx` with placeholder tabs
- `apps/mobile/metro.config.js` (one-liner calling `@supa-media/metro`)
- `apps/mobile/app.config.js` with push notification config, deep linking
- `.github/workflows/` with reusable workflow wrappers (strictness-aware)
- `native-deps.json` with defaults
- `.env.example` with 1Password paths for ALL configured services
- `CLAUDE.md` with framework conventions
- `.claude/` with Supa-compatible skills and commands
- `eslint.config.js` extending `@supa/linter`
- `docs/upgrading.md` template for tracking framework version and upgrade notes

### Post-Scaffold
```bash
cd my-app
pnpm install
pnpm setup:secrets          # pulls from 1Password
npx convex dev              # creates Convex deployment
pnpm dev                    # app is running
```

---

## Build Plan

Focus: Build the best possible framework for new apps. Migration of Togather/Fount is secondary — do it when convenient, don't let it constrain the design.

### Phase 1: Core + Backend (Week 1-3)

**Infrastructure packages:**
1. `@supa-media/core` — Providers (Convex, OTA, ErrorBoundary, Keyboard, Network, SafeArea), navigation helpers (Modal, BottomSheet), form utilities (KeyboardAwareFormContainer)
2. `@supa-media/convex` — OTP auth (Twilio + Resend), auth helpers, base schema (users, tenants), multi-tenancy utilities
3. `@supa-media/metro` — `createMetroConfig()` factory
4. `@supa-media/native-safety` — fingerprint + import checking + `hasNativeModule()`
5. `@supa-media/dev` — dev script orchestrator
6. `@supa-media/scripts` — secret sync, OTA versioning, setup-secrets

**Enforcement packages:**
7. `@supa-media/linter` — ESLint rules (native gating, route naming, platform files, keyboard-in-forms)
8. `@supa-media/testing` — Routing conflict detection, web bundle safety, React resolution

### Phase 2: Notifications + Payments (Week 3-4)

9. `@supa-media/notifications` — NotificationProvider, push token management, Expo Push API integration, deep link routing, Convex backend (token storage, notification queue, send helpers)
10. `@supa-media/payments` — Stripe integration with staging/prod keys, webhook handler, subscription management, PaywallGate component

### Phase 3: Chat Module (Week 4-5)

11. `@supa-media/chat` — MessageList (inverted FlatList + cursor pagination), MessageInput (keyboard-aware), offline caching (Zustand + AsyncStorage), ConvexChatAdapter, chat schema tables

### Phase 4: CI/CD + Scaffolder (Week 5-6)

12. Reusable GitHub workflows (ci, deploy-convex, deploy-mobile-update, build-native, deploy-web) — parameterized for strictness levels
13. `create-supa-app` CLI — interactive prompts, template generation, service validation

### Phase 5: Validation (Week 7)

14. Scaffold a brand new app from scratch using `create-supa-app`
15. Verify full lifecycle: dev → CI → staging → production
16. Verify all modules: auth, notifications, chat, payments

### Phase 6: Migration (When Ready)

Migrate Fount Studios first (simpler), then Togather. This is not time-boxed — do it when it makes sense.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **OTP only for auth** | Both apps use phone/email OTP. Keep it simple. Other auth can be added later. |
| **npm packages, not templates** | Templates go stale. `pnpm update @supa-media/*` propagates improvements. |
| **Chat as a separate module** | Not every app needs chat. But those that do shouldn't rebuild pagination, offline caching, and keyboard handling from scratch. |
| **ESLint rules for conventions** | File structure and patterns are enforced at lint time, not just documented. Catches violations before CI. |
| **Test suites for Expo gotchas** | Routing conflicts, web bundle safety, React resolution — these catch real production bugs. Ship them as reusable test packages. |
| **1Password required** | Both apps use it. Opinionated choice eliminates secret management bikeshedding. |
| **Multi-tenancy is a scaffold-time choice** | Adding it later is painful (schema migration, query changes). Decide upfront. |
| **Keyboard handling at framework level** | Every Expo app hits this. Solving it once in `@supa-media/core` prevents the #1 form UX complaint. |
| **Notifications as core module** | Every real app needs push notifications. Firebase/APNs setup is painful and error-prone. Do it once. |
| **Configurable deploy strictness** | Side projects and production SaaS have different needs. Don't force ceremony on prototypes. |
| **Consumer-driven updates (Next.js model)** | Consumers update on their own schedule via `pnpm update @supa-media/*`. Changelogs + codemods for breaking changes. No automated PRs — scales to any number of consumers. |

---

## Web Deployment

**Default: EAS Hosting** for the main app (Expo web export → EAS). This is the simplest path and keeps everything in the Expo ecosystem.

**Optional: Cloudflare Pages** for standalone landing pages / marketing sites. Configurable in `supa.config.ts`:

```typescript
web: {
  app: 'eas-hosting',           // main app — always EAS Hosting
  landing: 'cloudflare-pages',  // optional landing page — Cloudflare Pages or 'none'
}
```

If `landing` is configured, the scaffolder generates an `apps/web/` Vite + React landing page with Cloudflare Pages deployment workflow.

---

## `@supa-media/claude` — Claude Code Config

Framework-specific Claude Code configuration, scaffolded into every consumer app's `.claude/` directory.

### What's Included

**Commands** (shipped as templates, consumer can customize):
- `/review-cycle` — PR review cycle agent
- `/auto-worker` — Autonomous implementation agent
- `/fix-ci` — CI failure diagnosis and fix
- `/isolate` — Isolated development in worktree
- `/ios-build` — iOS build and deployment

**Skills**:
- `orchestrator` — Multi-step task planning and delegation
- `simplify` — Code quality review

**Hooks**:
- Pre-commit hooks for Supa lint rules
- Stop hooks for activity logging

**CLAUDE.md Template**:
- Framework conventions and file structure rules
- Tech stack reference (Convex + Expo + Supa modules)
- Dev workflow (setup, testing, deployment)
- Supa-specific patterns (native gating, keyboard handling, etc.)

### Update Flow
When `@supa-media/claude` is updated, consumer apps get updated templates. The scaffolder can re-generate `.claude/` config:
```bash
npx @supa-media/claude sync    # updates commands, skills, hooks to latest
```

---

## Open Questions

*(None remaining — all decisions resolved.)*

---

## Verification Plan

After each phase, verify:
1. `node packages/create-supa-app/src/index.js test-app` → scaffolds correctly with all selected features
2. `pnpm install && pnpm setup:secrets && pnpm dev` → app runs in under 2 minutes
3. Auth flow works (phone OTP + email OTP)
4. Push notifications register token, receive test notification, deep link resolves
5. Chat works (if enabled) — send message, scroll history, go offline/online
6. Payments work (if enabled) — Stripe checkout, subscription status, webhook handling
7. Keyboard doesn't hide form inputs on any screen
8. CI passes — lint rules catch violations, tests catch routing conflicts
9. OTA update deploys correctly (per strictness level)
10. Native change detected when adding a gated dep
11. Multi-tenancy works (if enabled) — tenant creation, switching, data isolation
12. Deploy strictness levels work — relaxed auto-deploys, standard requires promotion, strict requires canary
13. `pnpm update @supa-media/*` in consumer app → CI passes → OTA deploys (framework update flow)
