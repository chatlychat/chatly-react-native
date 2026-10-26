# @chatlychat/react-native

React Native SDK for the Chatly live chat platform. Drop-in chat inbox, help
center, and push-notification wiring for iOS and Android. Talks to the same
`/v1/widget/*` REST surface and Socket.IO realtime channel as the web widget.

## Install

```sh
npm install @chatlychat/react-native @react-native-async-storage/async-storage
# or
yarn add @chatlychat/react-native @react-native-async-storage/async-storage
```

`react` and `react-native` are peer dependencies. `@react-native-async-storage/async-storage`
(`^1.17 || ^2`) is an **optional** peer: it is the default storage, and you can
pass your own instead (see Storage). `socket.io-client` is bundled.

For bare React Native apps, run `pod install` in `ios/` after installing
AsyncStorage.

## Quick start

Wrap your app in `<ChatlyProvider>` and drop in `<ChatlyWidget />`.

```tsx
import { ChatlyProvider, ChatlyWidget, useChatly } from '@chatlychat/react-native';

export default function App() {
  return (
    <ChatlyProvider config={{ publicId: 'pub_abc123', apiHost: 'api.chatlychat.com' }}>
      <Support />
    </ChatlyProvider>
  );
}

function Support() {
  const { unreadCount, identify, setPushToken } = useChatly();
  return <ChatlyWidget />;
}
```

### Storage

The visitor token and last identity are kept in AsyncStorage by default. Pass
`storage` in the config to use anything else — anything with `getItem`,
`setItem` and `removeItem`, sync or async:

```tsx
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV();
const storage = {
  getItem: (k: string) => mmkv.getString(k) ?? null,
  setItem: (k: string, v: string) => mmkv.set(k, v),
  removeItem: (k: string) => mmkv.delete(k),
};

<ChatlyProvider config={{ publicId: 'pub_abc123', storage }}>
```

With `storage` set, `@react-native-async-storage/async-storage` need not be
installed. Without it, AsyncStorage `^1.17 || ^2` is the fallback, which covers
the version Expo SDK 51 and 52 pin (1.23.x).

## Identifying users

Call `identify()` once you know who the user is. The SDK persists a visitor
token under `chatly:vt:<publicId>` in AsyncStorage, so subsequent app launches
re-attach to the same contact automatically.

```tsx
const { identify } = useChatly();

await identify({
  externalId: 'user-123',
  email: 'alex@example.com',
  name: 'Alex',
  // HMAC-SHA256(externalId, workspace identity secret). Compute server-side.
  userHash: 'a1b2c3…',
});
```

`userHash` is optional but strongly recommended in production — without it,
any client could impersonate any `externalId`.

## Push notifications

The SDK does not bundle a push provider — pick the one that suits your app:

- Expo: `expo-notifications` → `getDevicePushTokenAsync()`
- Bare RN: `@react-native-firebase/messaging` → `messaging().getToken()`
- iOS APNs directly: `@react-native-community/push-notification-ios`

Then forward the token to Chatly:

```tsx
import messaging from '@react-native-firebase/messaging';

const { setPushToken } = useChatly();

useEffect(() => {
  (async () => {
    const auth = await messaging().requestPermission();
    if (auth) {
      const token = await messaging().getToken();
      await setPushToken({ platform: 'ios', token, bundleId: 'com.your.app' });
    }
  })();
}, [setPushToken]);
```

On the native side you still need the standard setup for your provider:

- iOS: enable Push Notifications + Background Modes (Remote notifications) in
  Xcode, and configure an APNs key in the Chatly dashboard.
- Android: add `google-services.json` and the FCM Sender ID in the dashboard.

## Customization

Pass a `theme` prop to override the defaults. Anything you omit falls back to
the default palette (primary `#2563eb`, background `#ffffff`, foreground
`#0f172a`).

```tsx
<ChatlyProvider
  config={{ publicId: 'pub_abc123' }}
  theme={{ colors: { primary: '#10b981', onPrimary: '#ffffff' } }}
>
  <App />
</ChatlyProvider>
```

Need full control over rendering? Use the lower-level pieces directly:

```tsx
import { MessagesList, Composer, HelpCenter } from '@chatlychat/react-native';
```

## Rich blocks and card actions

Bot replies can carry cards, a carousel, a price, quick replies and a status
line. `MessageBubble` renders them, so you get them for free — and the buttons
on them are real buttons, unlike the read-only rendering in the agent app.

Four of the five action kinds are handled for you: a `url` opens a link, a
`postback` sends a reply (invisibly, if the card asked), a `step` requests a
canvas. The fifth is yours.

### `host_event` — the one your app has to run

A card saying **Pay $48.20** cannot run Stripe from inside a chat library. It
has to happen in your app, with the buyer's real session and a native payment
sheet. So the SDK does nothing for a `host_event` and calls you:

```tsx
<ChatlyProvider
  config={{ publicId: 'pub_abc123' }}
  onAction={async ({ event, data, conversationId, messageId, actionId }) => {
    if (event !== 'pay' || conversationId === null) return;
    try {
      await presentNativePaymentSheet(data);
      await rest.reportAction(conversationId, {
        messageId,
        actionId,
        status: 'done',
        text: 'Paid — thank you!',
      });
    } catch (err) {
      await rest.reportAction(conversationId, { messageId, actionId, status: 'failed' });
    }
  }}
>
  <App />
</ChatlyProvider>
```

**Report the outcome.** `reportAction` is what appends the visible line under
the card and tells the bot what happened. Without it the shopper is looking at
a card with nothing under it and the bot asks again.

### Canvas steps

A Tier 2 canvas is a form inside the bubble — a confirm step for a purchase,
a return request. `MessageCanvas` renders it and submits it, and the step's
answer replaces what is on screen: a changed total comes back as a **fresh
step** rather than a charge.

Inputs are `text`, `textarea`, `email`, `tel`, `number`, `select` and `toggle`,
the same as the web widget. `visibleWhen` shows an input only while a toggle or
select holds a value; a hidden input is not drawn, not submitted and not
summed. A step's `price` plus the `adds` of each selected option is the running
total, and a submit action with `showTotal` names it ("Confirm & buy ·
$145.49"). The total is presentation only: your endpoint prices the order from
the values it receives. If options add in a different currency from the step's
price, no total is shown. The same rules are exported as `computeCanvasTotal`
and `visibleInputIds`.

A step's answer may itself carry a host event (this is how 3-D Secure works on
a phone), and that reaches the same `onAction`.

A Tier 3 canvas — your own page in a sandboxed frame — is deliberately **not**
rendered. There is no React Native equivalent of a sandbox attribute, and a
WebView is the thing a native SDK exists to avoid. The SDK shows the step's
title and leaves it to you.

### Rendering blocks yourself

Want your own card design, a real markdown renderer, a video player, a native
clipboard? Read the envelope and render it:

```tsx
import { readBlocksEnvelope, formatMoney } from '@chatlychat/react-native';

const envelope = readBlocksEnvelope(message.blocks);
```

`readBlocksEnvelope` applies the same refusals the rest of the product does —
`https:` media only, an unreadable price dropped rather than rendered as
`NaN`, an unknown block type dropped instead of throwing. Prices are **minor
units**: `4820` is `$48.20` and also `¥4,820`. Use `formatMoney`; the divisor
is not 100.

## API surface

| Export                                                    | Purpose                                            |
| --------------------------------------------------------- | -------------------------------------------------- |
| `ChatlyProvider`                                          | Bootstraps clients, restores session               |
| `ChatlyWidget`                                            | Drop-in inbox + help center UI                     |
| `useChatly()`                                             | Access session, identify, push token, refresh      |
| `MessagesList`, `Composer`, `MessageBubble`, `HelpCenter` | Composable UI                                      |
| `MessageBlocks`, `MessageCanvas`                          | Cards and canvas steps, rendered                   |
| `onAction` on `ChatlyProvider`                            | `host_event` card actions, for your app to run     |
| `RestClient`, `RealtimeClient`                            | Headless access                                    |
| `useTyping(id)`                                           | Who is typing, with the bot's `label`              |
| `useChatly().profile`, `rest.resolveProfile`              | Starters, quick links, copy for this visitor       |
| `rest.dismiss`                                            | Remove a thread from the visitor's list            |
| `Composer` `value` / `onChangeText`                       | Host-controlled draft                              |
| `rest.reportAction`                                       | Tell the thread and the bot what your app did      |
| `readBlocksEnvelope`, `readCanvas`                        | Render blocks yourself, with the same refusals     |
| `formatMoney`, `readMoney`                                | Minor-unit prices, formatted for the device locale |
| `registerPushToken`                                       | Helper used by `setPushToken`                      |
| `defaultTheme`, `ChatlyTheme`                             | Theming                                            |

## License

MIT

---

## About this repository

This is a **mirror**. `@chatlychat/react-native` is built from a private monorepo where the rest
of the platform, its migrations and its contract checks live, so a pull request here
cannot be merged directly — but a patch is still the fastest way to get something
fixed and we will port it with attribution.

What you can do here: read the source, run the tests, open an issue, or open a PR
and we will treat the diff as the proposal.

Not mirrored: src/ChatlyProvider.spec.tsx, src/blocks/canvas-total.parity.spec.ts, src/blocks/money.parity.spec.ts, src/blocks/read-envelope.parity.spec.ts, src/blocks/read-envelope.spatial.parity.spec.ts, src/client/wire-vocabulary.parity.spec.ts, src/navigate-and-notice.spec.tsx, src/theme/resolveTheme.spec.ts, src/theme/widget-theme-map.spec.ts — specs that assert a type restated here still
matches the monorepo's original, which is only a meaningful claim inside it. They
keep running there.

Issues: https://github.com/chatlychat/chatly-react-native/issues · Docs: https://chatlychat.com/docs
