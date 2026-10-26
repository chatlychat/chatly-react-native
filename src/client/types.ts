/**
 * Wire types shared between the REST + realtime clients and the React layer.
 *
 * These mirror the server-side widget contract in `apps/widget/src/client.ts`
 * and the realtime envelope in `packages/shared/src/realtime/index.ts`. We do
 * not import from those packages directly to keep the published SDK free of
 * workspace-internal dependencies.
 */

import type { ChatlyStorage } from '../storage/TokenStore';

export interface ChatlyConfig {
  /** Public workspace identifier, e.g. `pub_abc123`. */
  publicId: string;
  /** API host (no scheme). Defaults to `api.chatlychat.com`. */
  apiHost?: string;
  /** Override the realtime host. Defaults to the apiHost. */
  realtimeHost?: string;
  /** When false, the SDK uses `http://`/`ws://` instead of TLS. Defaults to true. */
  secure?: boolean;
  /**
   * BCP-47 locale for this visitor, e.g. `de-DE`.
   *
   * Omit it and the SDK reads the device's own via `Intl`, which is the right
   * answer for almost every app. Set it when the app has its OWN language
   * picker — a user who chose English inside a German phone's settings should
   * reach an English-speaking agent.
   *
   * It used to be neither: `init` sent the literal `'en-US'` with no way to
   * override, so every React Native visitor's contact record, help-centre
   * language negotiation and workflow locale condition said US English.
   */
  locale?: string;
  /**
   * IANA timezone for this visitor, e.g. `Europe/Berlin`. Omit it and the SDK
   * reads the device's own. Previously hardcoded `'UTC'`, which made every
   * native visitor's agent-visible local time wrong.
   */
  timezone?: string;
  /**
   * The origin of YOUR site (`https://shop.example`), for `navigate` actions.
   *
   * A `navigate` card button carries a path (`/pricing`). With an `onNavigate`
   * hook your app routes it itself; with none, and this set, the SDK opens
   * `siteOrigin + path` in the system browser. Unset and unhooked, a
   * `navigate` press does nothing rather than guess a host. Must be an
   * `https:` origin; anything else is ignored.
   */
  siteOrigin?: string;
  /**
   * Where the visitor token and last identity are kept: anything with
   * `getItem` / `setItem` / `removeItem`, sync or async — AsyncStorage (any
   * version), or expo-secure-store / MMKV behind a three-line wrapper.
   *
   * Omit it and the SDK falls back to `@react-native-async-storage/async-storage`
   * exactly as before. Pass it and that package need not be installed.
   */
  storage?: ChatlyStorage;
}

export interface ChatlyIdentity {
  externalId: string;
  email?: string;
  name?: string;
  /** HMAC-SHA256 of the externalId using the workspace identity secret. */
  userHash?: string;
  attributes?: Record<string, unknown>;
}

export interface SessionState {
  token: string;
  contactId: string;
  workspaceId: string;
  brandId: string;
  channelId: string;
}

export interface InitResponse {
  session: SessionState;
  workspace: { id: string; name: string };
  branding: Record<string, unknown>;
}

export interface StartResponse {
  conversation: { id: string };
  message: { id: string; body: string; createdAt: string };
}

/**
 * Five states, and `merged` is the one that was missing.
 *
 * `POST /v1/widget/conversations/list` returns the full
 * `conversationStatusSchema` (`packages/shared/src/schemas/conversation.ts`)
 * — it applies no status filter — and an agent merging two of a contact's
 * threads sets the loser's status to `merged`
 * (`conversations-merge.service.ts`). That is an ordinary thing to do to a
 * visitor who opened the chat twice, so the row reaches this client.
 *
 * It was a four-value union, which made the state unrepresentable: a
 * consumer's `switch` had no arm for it and `exhaustive: never` would have
 * compiled. Held against the shared schema by `wire-vocabulary.parity.spec.ts`.
 */
export type ConversationStatus = 'open' | 'snoozed' | 'closed' | 'pending' | 'merged';

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  subject: string | null;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadContactCount: number;
  createdAt: string;
}

export type MessageAuthor = 'contact' | 'agent' | 'bot' | 'system';
/**
 * What shape a message body is — and this union was wrong in BOTH directions.
 *
 * It read `'text' | 'image' | 'file' | 'attachment_only' | 'event' |
 * 'internal_note'`. The server's `message_kind` enum is
 * `text | rich | note | system_event | attachment_only`
 * (`@livechat/shared/message-kinds`), so four of those six were values
 * nothing can ever send — `MessageBubble` branched on `kind === 'event'`,
 * a comparison that was always false — while `rich` was absent.
 *
 * `rich` is the one that cost something. It is the kind every formatted reply
 * and every bot card carries, so a host app branching on `kind` could not
 * tell a product grid from a sentence. `sdk-swift`'s `Message.Kind` carries a
 * comment about the identical gap, fixed there and not swept here.
 *
 * `note` is absent deliberately, and that is the one narrowing that is
 * correct: an agent's internal comment never reaches a visitor. The gateway
 * forwards `text`, `rich`, `attachment_only` and `system_event`
 * (`VISITOR_VISIBLE_MESSAGE_KINDS`, `apps/realtime/src/visitor-allowlist.ts`) and the
 * history route filters `note` and `system_event` out in SQL, so `system_event`
 * is reachable on the socket and not on a reload.
 */
export type MessageKind = 'text' | 'rich' | 'attachment_only' | 'system_event';

/**
 * One file or image attached to a message. Produced by `POST /v1/widget/uploads`
 * and echoed back on every message payload that carries the attachment.
 *
 * Wire format is identical across all 4 mobile SDKs — the SDK renders
 * `image/*` mime types as inline thumbnails and anything else as a file row.
 */
export interface Attachment {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MessageRow {
  id: string;
  authorType: MessageAuthor;
  kind: MessageKind;
  body: string;
  attachments?: Attachment[];
  createdAt: string;
  /**
   * Rich blocks — cards, a carousel, quick replies, a status line.
   *
   * `unknown` on purpose, and validated by `readBlocksEnvelope` at render
   * time rather than typed here. The row comes off the wire: a server newer
   * than this app sends block types it does not know, and a row written
   * before a field was validated must produce the most of the message that
   * CAN be drawn rather than a type error. A declared shape here would be a
   * claim about a payload this package does not control.
   *
   * Absent until `blocks` was added to the message surface, so `undefined`
   * and `null` both mean "plain text".
   */
  blocks?: unknown;
  /** A Tier 2 canvas — a form inside the bubble. `unknown` for the same reason. */
  canvas?: unknown;
}

export interface KbResult {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
}

export interface KbArticle {
  id: string;
  slug: string;
  title: string;
  body: string;
  bodyHtml: string | null;
  updatedAt: string;
}

/**
 * Realtime envelope. Keep in lockstep with
 * `packages/shared/src/realtime/index.ts` (protocol version 1).
 */
export const REALTIME_PROTOCOL_VERSION = 1;

export type RealtimeEventType =
  | 'session.connected'
  | 'session.disconnected'
  | 'session.ping'
  | 'session.pong'
  | 'session.error'
  | 'subscribe'
  | 'unsubscribe'
  | 'replay.completed'
  | 'presence.online'
  | 'presence.offline'
  | 'presence.away'
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.assigned'
  | 'conversation.closed'
  | 'conversation.reopened'
  | 'message.created'
  | 'message.updated'
  | 'message.deleted'
  | 'message.read'
  | 'message.delivered'
  | 'typing.start'
  | 'typing.stop'
  | 'visitor.identified'
  | 'visitor.page_view'
  /** An ephemeral one-line toast answering this visitor's silent postback (ADR 0082). */
  | 'message.notice'
  | 'trigger.fired'
  | 'ai.copilot.suggestion'
  | 'ai.agent.message';

export interface RealtimeEnvelope<P = unknown> {
  v: typeof REALTIME_PROTOCOL_VERSION;
  type: RealtimeEventType;
  id: string;
  ts: number;
  workspace_id: string;
  payload: P;
}

/**
 * The `message.created` envelope, as the server actually sends it.
 *
 * This mirror is why a live card rendered as a bare bubble: it declared
 * seven fields, the server sends those plus `kind`, `blocks`, `canvas`,
 * `bodyHtml` and more, and `MessagesList` could only copy what the mirror
 * admitted existed. The shared schema under-declared `blocks` and `canvas`
 * too (fixed 2026-10-23), so reading either contract gave the same wrong
 * answer.
 *
 * `kind` is OPTIONAL because the schema makes it so, and a row with no kind
 * is a text row — the fallback belongs at the read, not here.
 *
 * `blocks` and `canvas` stay `unknown` deliberately, matching `MessageRow`:
 * `readBlocksEnvelope` is the authority on a block's shape, a server newer
 * than this app sends types it has never heard of, and a declared union here
 * would be a second reading of the block contract that drifts from the
 * first.
 */
export interface MessageCreatedPayload {
  id: string;
  conversationId: string;
  authorType: MessageAuthor;
  authorId: string | null;
  body: string;
  attachments: unknown[];
  createdAt: string;
  kind?: MessageKind;
  blocks?: unknown;
  canvas?: unknown;
}

export type PushPlatform = 'ios' | 'android' | 'expo';

export interface PushTokenRegistration {
  platform: PushPlatform;
  token: string;
  /** Bundle identifier or app id; helpful for multi-app workspaces. */
  bundleId?: string;
  /** Client app version (e.g. '1.4.2'); included in the registration record. */
  appVersion?: string;
}
