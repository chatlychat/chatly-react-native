/**
 * Wire types shared between the REST + realtime clients and the React layer.
 *
 * These mirror the server-side widget contract in `apps/widget/src/client.ts`
 * and the realtime envelope in `packages/shared/src/realtime/index.ts`. We do
 * not import from those packages directly to keep the published SDK free of
 * workspace-internal dependencies.
 */

export interface ChatlyConfig {
  /** Public workspace identifier, e.g. `pub_abc123`. */
  publicId: string;
  /** API host (no scheme). Defaults to `api.chatlychat.com`. */
  apiHost?: string;
  /** Override the realtime host. Defaults to the apiHost. */
  realtimeHost?: string;
  /** When false, the SDK uses `http://`/`ws://` instead of TLS. Defaults to true. */
  secure?: boolean;
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

export type ConversationStatus = 'open' | 'snoozed' | 'closed' | 'pending';

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
export type MessageKind = 'text' | 'image' | 'file' | 'attachment_only' | 'event' | 'internal_note';

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

export interface MessageCreatedPayload {
  id: string;
  conversationId: string;
  authorType: MessageAuthor;
  authorId: string | null;
  body: string;
  attachments: unknown[];
  createdAt: string;
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
