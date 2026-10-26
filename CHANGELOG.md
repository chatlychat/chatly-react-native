# @chatlychat/react-native

## 0.13.0 — 2026-10-26

- **`PickedAttachment` is exported.** The type `pickAttachment` returns was only reachable as `ComposerProps['pickAttachment']`, which is what a host writing a picker had to type against (Crossly). Cosmetic, and `0.12.0`'s whole point was that writing a picker is the host's job, so the type it returns has to have a name.

## 0.12.0 — 2026-10-26

- **A picker may return a `uri` or `base64`, not only bytes.** `<Composer pickAttachment>` (preferred over `globalThis.__chatlyPicker`, which still works) accepts `{ bytes }`, `{ uri }` or `{ base64 }` with `filename` and `mimeType` optional, and the SDK reads the file. **No Expo picker returns bytes** — `expo-image-picker` and `expo-document-picker` both give a `uri` — so the old contract made every Expo app write a `fetch(uri)` read or its own base64 decoder, since some RN engines have no `atob`. `base64` wins over `uri` when both are present (the in-memory copy is the cheaper read) and a `data:` prefix is accepted whole. No `expo-image-picker` adapter: that would mean taking the dependency.
- **`config.apiUrl` takes a whole URL** and wins over `apiHost` / `secure`, as every other client already did. Trailing slash trimmed. The default host is `api.chatlychat.com`, now pinned by a test — the docs page carried a warning naming a domain we do not own, true of `0.1.1` and stale ever since.
- **An own-site `url` action routes through `onNavigate`.** An older card, an agent typing a full link and a help article all arrive as `url` rather than `navigate`, and the system browser lost the visitor's place for a screen the app owns. Needs `config.siteOrigin`; the origin is compared as a parsed `URL.origin`, not a string prefix, so `https://shop.example.evil.test` is not treated as own-site. The same path guard applies and an `http:` `siteOrigin` routes nothing.

## 0.11.0 — 2026-10-26

- **Typing indicator, with the bot's `label`.** `<MessagesList>` shows who is typing, or the bot's own words ("Looking at your photo…") when the `typing.start` event carries a `label`; it clears on `typing.stop`, on the agent's or bot's next message, and after 3.5s without another `start` (the core's window). New `useTyping(conversationId)` returns `{ actorType, actorId, displayName, label } | null` for a custom thread. Receiving only: this SDK still does not send the visitor's typing.
- **Profile resolution.** `rest.resolveProfile(locale?)` calls `POST /v1/widget/profile/resolve` and `useChatly().profile` holds the result (`starterPrompts`, `quickLinks`, `copy`, `matched`) after init and after `identify()`; `null` until resolved or if the call failed. New types `ProfileView`, `TypingState`.
- **Remove a conversation from the visitor's list.** `rest.dismiss(conversationId)` calls `POST /v1/widget/conversations/:id/dismiss`; `<ChatlyWidget />` rows have a "Remove" action. Not a delete: the workspace keeps the record and a newer message brings the thread back.
- **Controlled `<Composer>`.** New `value` and `onChangeText` props let the host own the draft (speech recognition, a tapped starter). Omit both and nothing changes. No imperative `setDraft`: controlled props cover both cases without a ref API to keep in step.

## 0.10.0 — 2026-10-26

- **Bring your own storage.** `ChatlyConfig.storage` takes anything with `getItem` / `setItem` / `removeItem`, sync or async (AsyncStorage, expo-secure-store or MMKV behind a small wrapper). Omit it and nothing changes: the lazy AsyncStorage `require` is still the fallback. New type `ChatlyStorage`.
- **The AsyncStorage peer is now `^1.17 || ^2` and optional**, so Expo SDK 51/52 (which pin 1.23.x) can install the SDK, and an app that injects `storage` need not install it at all.
- **Canvas parity with the web widget.** Inputs `textarea` and `toggle`, `visibleWhen`, select options with `adds`, the step `price`, and `showTotal` on a submit button ("Confirm & buy · $145.49"). A hidden input is not drawn, not submitted and not summed; mixed currencies show no total. New exports `computeCanvasTotal` and `visibleInputIds`, pinned to the web widget's by a parity spec.
- **Fixed: the canvas reader looked for `fields[]` keyed by `name`; the server stores `inputs[]` keyed by `id`.** `readCanvas` now reads `inputs`/`id`/`toggle` and still accepts the old `fields`/`name`/`checkbox` shape. Breaking for type consumers: `WidgetCanvas.fields` is now `inputs`, `CanvasField.name` is `id`, and the `checkbox` type is `toggle`.

## 0.9.0 — 2026-10-26

- `navigate` is now also accepted as a card's image/title tap target and as a grid's `more` tile, with the same path guard and the same `onNavigate` / `siteOrigin` behaviour as a navigate button. `WidgetGridMore.action` widens to `postback | url | navigate`.

## 0.8.0 — 2026-10-26

- **`navigate` card actions.** A card button can now carry a PATH on your site (`/pricing`). `<ChatlyProvider onNavigate={(e) => …}>` receives `{ path, label, conversationId, messageId, actionId }` and returns `true` when your router handled it; otherwise, if `config.siteOrigin` is set to your `https:` origin, the SDK opens `siteOrigin + path` in the system browser, and with neither it does nothing rather than guess a host. The path is checked again before either runs.
- **`onNotice`.** `<ChatlyProvider onNotice={(n) => …}>` receives the ephemeral one-line toast a bot sends to answer a silent postback (`{ conversationId, replyTo, body }`). It is not a message: it is never in the thread and only arrives over the live socket.
- New `ChatlyConfig.siteOrigin`; new types `ChatlyNavigateEvent` and `ChatlyNotice`.

## 0.7.2 — 2026-10-26

The web theme's `anchor` is classified as not applicable on a phone (it positions the web panel above an element on the host page), so it no longer reads as a setting nobody decided about.

## 0.7.1 — 2026-10-26

`mailto:` and `tel:` url actions now render and open, as on the web widget. The reader is an allow-list of exactly the schema's three schemes (`https`, `mailto`, `tel`), so no other scheme — `intent:`, `sms:`, an app's own — ever reaches `Linking.openURL`.

## 0.3.0 — 2026-10-16

Released because the code below was in the repository and not on npm. A gate
added today (`check-unreleased-package-changes.mjs`) found this package and the
CLI sitting in the same state `@chatlychat/sdk-node` was caught in by a
customer: source moved on, version did not, so nobody could install the work.

### Added

- The four commerce block fields render — `card.variants`, `card.stock`,
  `card_grid.more` and `order_status` — through the same envelope reader every
  other surface uses, with a parity spec proving the composed reader is
  byte-identical to the widget's split one.

### Fixed

- **Realtime could not connect at all.** The handshake omitted
  `kind: 'visitor'`, and `handshakeAuthSchema` defaults that to AGENT, so a
  visitor's HS256 token was verified as RS256 and refused with a bare
  `Unauthorized` naming neither credential. The token is also
  conversation-scoped with a 1h TTL, so `auth` is now re-read per connect
  ATTEMPT — a frozen auth object is replayed on reconnect and the socket dies
  silently for the rest of the session.

## 0.2.0

### Fixed

- **Realtime could not connect, at all, for anyone.** The handshake sent
  `{ token, workspaceId, contactId }` with the long-lived session token from
  `/v1/widget/init`. `handshakeAuthSchema` accepts `{ token, kind? }` and
  `kind` **defaults to agent**, so a visitor's HS256 token was verified as
  RS256 against the platform public key and refused with a bare
  `Unauthorized` naming neither credential. Two wrong things pointing the same
  way: the credential and the missing label.

  `RealtimeClient.connect` is now
  `connect({ session, conversationId, mintToken })` — a **breaking change**,
  because the old signature could not work. It mints a conversation-scoped
  token at `POST /v1/widget/realtime/token` (`RestClient.mintRealtimeToken`),
  sends `{ token, kind: 'visitor' }`, and passes `auth` as a **callback** so
  every reconnect attempt re-reads it; the token is re-minted when the socket
  drops, because a frozen credential outlives its 1h TTL and is then refused
  silently for the rest of the session.

  A visitor socket is scoped to one conversation, so the provider no longer
  opens one at init. `activeConversationId` / `setActiveConversation` are on
  the context, `<MessagesList>` sets them for the thread it renders, and a
  switch re-mints and reconnects. A refused mint lands on `realtimeError`
  rather than `error`: live delivery is off, the thread still works over REST.

- **`uploadAttachment` posted a shape the route does not accept.** It sent
  `{ filename, mimeType, data }` — base64 bytes — to
  `POST /v1/widget/uploads/presign`, whose schema is
  `{ visitorToken, publicId, filename, contentType, sizeBytes }` and which
  takes no bytes at all, so zod dropped two keys and answered 400 on the
  missing `contentType`. It is now the real three-step flow: presign, PUT the
  raw bytes to the returned URL with the returned method and headers, then put
  `{ id, filename, mimeType, sizeBytes, url }` on the message. Attachments
  work from this SDK for the first time.

- **A refused call now carries the server's own words.** `ChatlyRequestError`
  (exported) has `status`, `code`, `path` and a `message` that is the API's
  `error.message` when it sent one. The upload route's three refusals —
  attachments off for the channel, a MIME type outside the allow-list, a file
  over the cap — are copy written for the visitor, and `Composer` now shows
  them instead of failing silently.

## 0.1.2

### Fixed

- **The default API host was `api.chatly.com`, a domain we do not own.** Any
  app that followed the README and omitted `apiHost` sent its visitors'
  sessions, messages and identity payloads to a third party's server. It is
  `api.chatlychat.com` now, in `RestClient`, in `RealtimeClient`'s fallback,
  in the README and in the example app.

  Worth stating plainly: this is the same class of defect as
  `api.livechat.local` in the JS and Node SDKs and `api.chatly.example` in the
  Kotlin and Swift ones, and worse than all three, because those are reserved
  names that resolve nowhere and fail on the first call. A live domain fails
  silently. `scripts/check-published-package-hosts.mjs` now requires a
  published default to be a `chatlychat.com` host rather than merely not a
  dev-shaped one.
