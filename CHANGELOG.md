# @chatlychat/react-native

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
