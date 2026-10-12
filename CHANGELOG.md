# @chatlychat/react-native

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

