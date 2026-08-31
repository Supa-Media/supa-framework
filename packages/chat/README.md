# @supa-media/chat

**A message list, an input bar, and the pagination/caching/optimistic-send plumbing between
them** — for Expo/React Native apps. The UI layer is backend-agnostic: everything reaches
your data through a `ChatAdapter` you supply, with a Convex implementation included. Message
bubbles are yours (`renderMessage`); the list, grouping, date separators, cursor pagination,
offline cache, and optimistic send are the package's.

Extracted from Togather's chat feature. The Convex functions it talks to are **not** in this
package — see [What you must build on the backend](#what-you-must-build-on-the-backend).

## Install

```bash
pnpm add @supa-media/chat
```

**Peer dependencies you install yourself:**

| Peer | Required? | Why |
| --- | --- | --- |
| `react >=19.0.0` | required | hooks + components |
| `react-native >=0.81.0` | required | `FlatList`, `TextInput`, `Keyboard` |
| `zustand >=5.0.0` | required | every store under `./stores` |
| `@react-native-async-storage/async-storage >=2.0.0` | required | the stores' persistence layer; imported unconditionally, so it must resolve even if you never read a cache |
| `convex >=1.31.0` | **optional** | *nothing in `src/` imports it.* `ConvexChatAdapter` takes your `api` object and client as untyped constructor args |

## Quick start

```tsx
function ChannelScreen({ channelId }: { channelId: string | null }) {
  // Memoize: the adapter is an effect dependency in every hook (see below).
  const adapter = useMemo(
    () =>
      new ConvexChatAdapter({
        api,
        client: convexClient,
        getAuthToken: () => authToken,
        getCurrentUserId: () => user?.id ?? null,
        getCurrentUser: () => (user ? { id: user.id, name: user.name } : null),
        functionNamespace: {
          getMessages: api.functions.messaging.messages.getMessages,
          sendMessage: api.functions.messaging.messages.sendMessage,
        },
      }),
    [authToken, user?.id],
  );

  const messagesResult = useMessages(adapter, channelId, 20);
  const { sendMessage, optimisticMessages, isSending } =
    useSendMessage(adapter, channelId, isEffectivelyOffline);

  return (
    <>
      <MessageList
        messagesResult={messagesResult}
        optimisticMessages={optimisticMessages}
        currentUserId={user?.id}
        renderMessage={({ message, showSenderInfo, optimisticStatus }) => (
          <MyBubble message={message} showSender={showSenderInfo} status={optimisticStatus} />
        )}
      />
      <MessageInput onSend={sendMessage} isSending={isSending} isOffline={isEffectivelyOffline} />
    </>
  );
}
```

`channelId={null}` is the skip idiom — every hook short-circuits and clears state.

> **⚠️ Construct the adapter inside `useMemo`.** `adapter` is in the dependency array of the
> effects in `useMessages`, `useChannels`, and `useUnreadCount`. A `new ConvexChatAdapter(…)`
> in the render body is a new identity every render, which re-fires the fetch effect every
> render — an unbounded query loop against your backend that looks, from the UI, like the
> channel simply loading slowly.

## API

### `@supa-media/chat/adapters`

`ChatAdapter` is the contract — required: `getMessages(channelId, limit, cursor?)`,
`sendMessage(channelId, content, options?)`, `getChannels(groupId?)`, `getCurrentUserId()`,
`getCurrentUser()`; optional: `subscribeMessages`, `subscribeChannels`, `getUnreadCount`.

`ConvexChatAdapter` implements it against a Convex client. Config: `api`, `client`,
`getAuthToken`, `getCurrentUserId`, `getCurrentUser`, `functionNamespace`
(`{ getMessages, sendMessage, listChannels?, getUnreadCount? }`, each a function reference).
It authenticates by passing `token` as a **function argument** on every call, not `ctx.auth`.

> **⚠️ `ConvexChatAdapter` gives you no real-time updates.** It calls `client.query(...)`
> imperatively and implements neither `subscribeMessages` nor `subscribeChannels`, so
> `useMessages` falls back to a one-shot fetch that re-runs only when `channelId`, `limit`,
> or the pagination cursor changes. A message sent by someone else never appears until
> something else re-triggers the effect. For live chat, either subclass it to implement
> `subscribeMessages` on top of Convex's `watchQuery`, or drive `useQuery` in your own screen
> and hand the result down. This is the single biggest surprise in the package.

> **⚠️ A missing `functionNamespace` entry fails differently per method.** `getMessages` and
> `sendMessage` throw a descriptive error. `getChannels` returns `[]` and `getUnreadCount`
> returns `0` — **silently**. An empty channel list is far more likely to be a forgotten
> `listChannels` reference than an empty backend. The same applies to a null auth token:
> `getMessages` returns an empty page rather than throwing.

### `@supa-media/chat/hooks`

| Hook | Signature | Returns |
| --- | --- | --- |
| `useMessages` | `(adapter, channelId, limit = 20)` | `{ messages, loadMore, hasMore, isLoading, isStale }` |
| `useSendMessage` | `(adapter, channelId, isOffline = false)` | `{ sendMessage, optimisticMessages, isSending, retryMessage, dismissMessage }` |
| `useChannels` | `(adapter, groupId)` | `{ channels, isLoading, isStale }` |
| `useUnreadCount` | `(adapter, channelId)` | `{ unreadCount, isLoading }` |

**`useMessages`** keeps a live page (cursor `undefined`) plus an accumulator of older pages.
`loadMore()` sets the cursor; when that page arrives it merges in, resets the cursor so the
live page resumes, and re-sorts ascending by `createdAt`, deduplicating by `_id`. `isStale`
means it is serving the AsyncStorage cache. Only the live page is ever written to that cache.

**`useSendMessage`** appends an `OptimisticMessage` (`_optimistic: true`, `_status` of
`"queued" | "sending" | "sent" | "error"`), then calls the adapter. On success the status
flips to `"sent"` and the entry is dropped after **3 seconds** — a state-cleanup fallback,
not the dedup mechanism (`MessageList` hides it the moment the real message arrives). On
failure it stays at `"error"` indefinitely, for `retryMessage(id)` or `dismissMessage(id)`.
`contentType` is inferred from `options.attachments`: any `image` ⇒ `"image"`, else any
`file` ⇒ `"file"`, else `"text"`.

> **⚠️ Offline sends are held in memory, not in `useOfflineQueue`.** `useSendMessage` keeps
> its own ref-based queue and flushes it on the `isOffline` true→false transition. Nothing is
> persisted: kill the app while offline and every queued message is gone, with no error. The
> exported `useOfflineQueue` store is a persisted queue that exists for exactly this gap, but
> **the hook does not use it** — wiring it in is your job if durability matters.

> **⚠️ `retryMessage` drops the original `options`.** It re-sends `msg.content` only, so
> attachments, mentions, and `parentMessageId` are lost on retry: a failed reply retries as a
> top-level message and a failed image retries as empty text.

### `@supa-media/chat/components`

**`MessageList`** — an inverted `FlatList`. Props: `messagesResult` (pass the whole
`useMessages` return), `renderMessage`, `optimisticMessages?`, `currentUserId?`, `theme?`,
`renderEmpty?`, `renderLoading?`, `style?`, `contentContainerStyle?`.

`renderMessage` receives `{ message, showSenderInfo, isOptimistic?, optimisticStatus? }`;
`showSenderInfo` is false for consecutive messages from one sender, so you can suppress the
avatar/name. The list adds date separators ("Today", "Yesterday", `Mar 4`, `Mar 4, 2024`), a
stale-cache banner, a load-more footer while `hasMore`, and a scroll-to-bottom button.
Pagination fires on `onEndReached` — which, on an inverted list, is the *top*. The empty
state is delayed 500 ms to avoid a flash during startup.

**`MessageInput`** — a multi-line input capped at 8 lines with a send button. Props: `onSend`
(required), `isSending?`, `replyTo?` (`{ id, content, senderName }`, renders the reply
banner), `onCancelReply?`, `isOffline?` (renders the queued-send hint), `maxLength?`
(default 2000), `placeholder?`, `theme?`, `style?`, `disabled?`,
`renderLeadingAccessory?`, `renderTrailingAccessory?`.

The accessory props are the extension points for what was deliberately stripped out: image
and document pickers, GIFs, voice memos, link previews. The input clears after `onSend`
resolves — and only if the text hasn't changed since the send began, so a fast typist doesn't
lose keystrokes — then re-focuses to keep the keyboard up on native.

Both components theme through flat colour maps (`MessageListTheme`, `MessageInputTheme`) with
iOS-ish defaults; there are no styling hooks beyond those and `style`.

> **⚠️ Optimistic deduplication is heuristic, and content equality is load-bearing.**
> `MessageList` hides a `"sent"` optimistic message when it finds a match among the **last 5**
> server messages with the same `senderId`, **byte-identical** `content`, and a `createdAt`
> within **5 seconds** (each server message can absorb only one optimistic, so genuine
> duplicate sends are handled). It fails to match — showing the message twice until
> `useSendMessage`'s 3-second cleanup fires — when the backend rewrites content on write
> (trimming, sanitizing, unfurling), when five or more other messages land between your send
> and the echo, or when client and server clocks differ by more than 5 s. Echo back exactly
> what was sent.

### `@supa-media/chat/stores`

Zustand + AsyncStorage, all stale-while-revalidate. Each is exported both as a ready-made
default instance and as a factory taking `ChatConfig`.

| Export | Storage key | Holds | Default limits |
| --- | --- | --- | --- |
| `useMessageCache` / `createMessageCache(config?)` | `supa-message-cache` | messages per channel | 50 messages/channel, 20 channels, 24 h |
| `useChannelCache` / `createChannelCache(config?)` | `supa-channels-cache` | channel list per group | 50 groups, 24 h |
| `useInboxCache` / `createInboxCache(config?)` | `supa-inbox-cache` | channel list per scope/tenant | 24 h |
| `useOfflineQueue` | `supa-offline-queue` | queued outbound messages | unbounded |

`useMessageCache` and `useChannelCache` are consumed automatically by `useMessages` and
`useChannels`; `useInboxCache` and `useOfflineQueue` are yours to call. Over-limit writes
evict the **oldest by write timestamp**, not by read recency, so a background refresh of a
channel you never open can push out one you use daily. Expiry is enforced on read: past
`cacheExpiryMs` the getter returns `null`, so an expired cache shows an empty list, not an
old one.

> **⚠️ `createMessageCache(config)` returns a *new store*, and the hooks don't use it.**
> `useMessages` imports the default `useMessageCache` instance directly. Calling a factory
> with custom limits gives you a second, parallel cache that the hooks ignore. The factories
> are for standalone use; there is no way to reconfigure the hooks' limits.

> **⚠️ `setGroupChannels` zeroes `unreadCount` on every channel before persisting.** This is
> deliberate — a cached badge count goes stale fast and a wrong badge is worse than none — but
> it means the offline channel list always shows zero unread. Read live counts from
> `useUnreadCount`.

### `@supa-media/chat/types`

`Message`, `MessageContentType`, `Attachment`, `OptimisticMessage`, `OptimisticStatus`,
`Channel`, `SendMessageOptions`, `ChatConfig`, `PaginatedMessagesResult`,
`UseMessagesResult`, `UseSendMessageResult`, plus the `DEFAULT_CHAT_CONFIG` value. The root
entry re-exports all of these along with everything above.

## What you must build on the backend

Your adapter is the only thing that knows your schema, so the contract is defined by what
`ChatAdapter` returns — not by any table this framework ships.

**`getMessages` must return `{ messages, hasMore, cursor }`**, where `messages` are in the
package's `Message` shape, **ascending by `createdAt`** (oldest first — `MessageList` reverses
for the inverted list), and `cursor` is whatever opaque string your next page needs.

`Message` requires `_id`, `channelId`, `senderId`, `content`, `contentType`, `createdAt`,
`isDeleted`; optional `parentMessageId`, `attachments`, `mentionedUserIds`,
`threadReplyCount`, `editedAt`, `hideLinkPreview`, and the denormalized `senderName` /
`senderProfilePhoto` that let a bubble render without a second query.

The reference implementation is Togather's `getMessages`: args `{ token, channelId, limit?,
cursor? }`, `hasMore` computed by fetching `limit + 1` rows, and a compound
`"<boundaryTime>:<ids>"` cursor rather than a row id — worth copying, since a bare-timestamp
cursor drops messages that share a millisecond.

> **⚠️ `supaChatTables` from `@supa-media/convex/schema` is not a drop-in backend for this
> package.** Those tables name the fields `body`, `userId`, and `replyTo`; this package's
> `Message` wants `content`, `senderId`, and `parentMessageId`, and there is no mapping layer
> anywhere in between — `ConvexChatAdapter` casts your query result straight to `Message[]`.
> Using both means writing the projection in your Convex query. The cast means a mismatch
> typechecks cleanly and surfaces as blank bubbles at runtime.

You also supply `sendMessage` (returning the new message id) and, if you want those features,
`listChannels` and `getUnreadCount`.

## Test coverage

One test: `__tests__/esm-resolution.test.js`, which walks the built `dist/` output and
asserts every relative ESM specifier resolves under Node's strict rules (the 1.0.1 CHANGELOG
explains why that bug class is invisible to `tsc` and to Metro). There are **no behavioural
tests** — nothing covers the pagination merge, cache eviction and expiry, optimistic dedup,
or the offline flush. Every gotcha above was read out of the source, not caught by a test;
treat them as the specification and verify on a device.

---

Part of the **Supa Media framework** — https://github.com/Supa-Media/supa-framework. MIT.
