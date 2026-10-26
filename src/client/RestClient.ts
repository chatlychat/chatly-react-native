/**
 * Thin wrapper around the widget REST surface (see `apps/widget/src/client.ts`).
 *
 * All write endpoints accept the `publicId` + `visitorToken` in the JSON body.
 * The visitor token is persisted via `TokenStore` and rotated whenever
 * `/v1/widget/init` returns a fresh one.
 */

import { Platform } from 'react-native';

import { deviceLocale, deviceTimezone } from './device-locale.js';
import { IdentityStore, TokenStore } from '../storage/TokenStore';

import type {
  Attachment,
  ChatlyConfig,
  ChatlyIdentity,
  ConversationSummary,
  InitResponse,
  KbArticle,
  KbResult,
  MessageRow,
  ProfileView,
  StartResponse,
} from './types';

/*
 * `api.chatlychat.com`, and `chatly.com` is not a domain we own.
 *
 * This read `api.chatly.com` — a real, resolvable host belonging to somebody
 * else — in a package PUBLISHED to npm as `@chatlychat/react-native@0.1.1`.
 * Every app that followed the README and omitted `apiHost` sent its visitor
 * sessions, messages and identity payloads to a third party's server.
 *
 * It is the same defect as `api.livechat.local` in the JS and Node SDKs and
 * `api.chatly.example` in the Kotlin and Swift ones, but worse in the way
 * that matters: those resolve nowhere, so they failed loudly and immediately.
 * This one is a live domain. `check-published-package-hosts.mjs` missed it
 * for exactly that reason — it was looking for reserved and dev-shaped names.
 * It now requires a published default to be a `chatlychat.com` host.
 */
const DEFAULT_API_HOST = 'api.chatlychat.com';

/**
 * A refused widget call, with the server's own words on it.
 *
 * `message` is the API's `error.message` when it sent one, and nothing else:
 * three of the upload route's refusals are copy written for the VISITOR to
 * read ("File uploads are turned off for this chat", "That file type is not
 * accepted: …", "Files must be under 10 MB"), and a composer should be able to
 * render `err.message` straight into the UI. This used to be
 * `[chatly] /v1/widget/uploads/presign failed: 400 {"error":{…}}` — the copy
 * was in there, buried in a developer string, which is the same as not having
 * it. `status`, `code` and `body` carry the developer half.
 */
export class ChatlyRequestError extends Error {
  public constructor(
    public readonly path: string,
    public readonly status: number,
    public readonly code: string | null,
    public readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChatlyRequestError';
  }

  public static from(path: string, status: number, body: string): ChatlyRequestError {
    const parsed = readErrorBody(body);
    return new ChatlyRequestError(
      path,
      status,
      parsed.code,
      body,
      parsed.message ?? `[chatly] ${path} failed: ${status} ${body}`,
    );
  }
}

/**
 * The API NESTS every error: `app-exception.filter.ts` ends with
 * `send({ error: body })`. The un-nested fallback is kept because a proxy or
 * a gateway in front of us may answer in its own shape.
 */
function readErrorBody(text: string): { code: string | null; message: string | null } {
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: unknown; message?: unknown };
      code?: unknown;
      message?: unknown;
    };
    const code = parsed.error?.code ?? parsed.code;
    const message = parsed.error?.message ?? parsed.message;
    return {
      code: typeof code === 'string' ? code : null,
      message: typeof message === 'string' && message.length > 0 ? message : null,
    };
  } catch {
    return { code: null, message: null };
  }
}

export class RestClient {
  private readonly apiUrl: string;
  private readonly publicId: string;
  private readonly tokenStore: TokenStore;
  private readonly identityStore: IdentityStore;
  private tokenCache: string | null = null;
  /** `undefined` = not yet read from disk; `null` = read, nothing stored. */
  private identityCache: ChatlyIdentity | null | undefined = undefined;
  /** App-supplied overrides; `undefined` means "use the device's own". */
  private readonly configLocale: string | undefined;
  private readonly configTimezone: string | undefined;

  public constructor(config: ChatlyConfig) {
    this.publicId = config.publicId;
    this.configLocale = config.locale;
    this.configTimezone = config.timezone;
    const host = config.apiHost ?? DEFAULT_API_HOST;
    const scheme = config.secure === false ? 'http' : 'https';
    this.apiUrl = `${scheme}://${host}`;
    this.tokenStore = new TokenStore(config.publicId, config.storage);
    this.identityStore = new IdentityStore(config.publicId, config.storage);
  }

  public get baseUrl(): string {
    return this.apiUrl;
  }

  public async getToken(): Promise<string | null> {
    if (this.tokenCache !== null) {
      return this.tokenCache;
    }
    this.tokenCache = await this.tokenStore.get();
    return this.tokenCache;
  }

  /**
   * Forget this device's session entirely. Backs `logout()`.
   *
   * Drops the remembered identity too: after a logout, a stale-session
   * recovery must NOT quietly re-identify as the person who just signed out.
   */
  public async clearToken(): Promise<void> {
    await this.dropToken();
    this.identityCache = null;
    await this.identityStore.clear();
  }

  /** Drop only the session credential, keeping the remembered identity so a
   *  recovery can replay it. */
  private async dropToken(): Promise<void> {
    this.tokenCache = null;
    await this.tokenStore.clear();
  }

  /**
   * The identity to replay after the server refuses a stale session.
   *
   * Only offered when we hold BOTH an external id and its hash — mirroring
   * `rememberedIdentity()` in `apps/widget/src/client.ts`. On a channel with
   * identity verification enabled a claim without a hash is refused, and on a
   * channel without it a legacy token is still accepted, so an unverifiable
   * replay could only ever turn one refusal into two. Without both, the SDK
   * re-inits anonymously and history returns as soon as the host app calls
   * `identify()` again.
   */
  private async rememberedIdentity(): Promise<ChatlyIdentity | undefined> {
    if (this.identityCache === undefined) {
      this.identityCache = await this.identityStore.get();
    }
    return this.identityCache ?? undefined;
  }

  public async init(identity?: ChatlyIdentity): Promise<InitResponse> {
    const token = await this.getToken();
    const body: Record<string, unknown> = {
      publicId: this.publicId,
      visitorToken: token ?? undefined,
      locale: this.configLocale ?? deviceLocale(),
      timezone: this.configTimezone ?? deviceTimezone(),
      page: { url: `app://${Platform.OS}`, title: 'native' },
    };
    if (identity !== undefined) {
      body.identity = identity;
    }
    const parsed = await this.post<InitResponse>('/v1/widget/init', body);
    if (parsed.session.token) {
      this.tokenCache = parsed.session.token;
      await this.tokenStore.set(parsed.session.token);
    }
    // Remembered only once the server has ACCEPTED the identity, and only
    // when it carries a hash — see `rememberedIdentity()`.
    if (identity !== undefined && identity.userHash !== undefined) {
      this.identityCache = identity;
      await this.identityStore.set(identity);
    }
    return parsed;
  }

  public async start(body: string, attachments?: Attachment[]): Promise<StartResponse> {
    return this.post<StartResponse>('/v1/widget/conversations', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      body,
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    });
  }

  public async reply(
    conversationId: string,
    body: string,
    attachments?: Attachment[],
  ): Promise<unknown> {
    return this.post<unknown>('/v1/widget/messages', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      conversationId,
      body,
      ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
    });
  }

  /**
   * A card's `postback` action: a reply the bot reads, optionally invisible.
   *
   * `silent` is what makes a filter chip work — the agent hears "under_50"
   * and the shopper does not see their own tap echoed as a message bubble.
   * It is a separate method rather than an option on `reply` because the two
   * differ in whether anything renders.
   */
  public async postback(
    conversationId: string,
    input: { value: string; payload?: Record<string, unknown>; silent?: boolean },
  ): Promise<unknown> {
    return this.post<unknown>('/v1/widget/messages', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      conversationId,
      body: input.value,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
      ...(input.silent === true ? { silent: true } : {}),
    });
  }

  /**
   * Report what the APP did about a `host_event` card action.
   *
   * This is the other half of the one feature a native SDK exists for. A card
   * saying "Pay $48.20" cannot run Stripe from inside a chat library — the
   * app does it, with the buyer's real session and a native payment sheet —
   * and then has to say what happened, or the shopper is left looking at a
   * card with nothing under it and the bot asks again.
   *
   * `text` appends a visible line under the card. `status: 'failed'` with no
   * text is legitimate: the bot is told, and the shopper sees the card
   * unchanged rather than an error they can do nothing about.
   */
  public async reportAction(
    conversationId: string,
    input: {
      messageId: string;
      actionId: string;
      status: 'done' | 'failed';
      text?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<{ blocks: unknown; deliveredMessageId: string }> {
    return this.post<{ blocks: unknown; deliveredMessageId: string }>(
      `/v1/widget/conversations/${encodeURIComponent(conversationId)}/action-result`,
      {
        publicId: this.publicId,
        visitorToken: (await this.getToken()) ?? '',
        messageId: input.messageId,
        actionId: input.actionId,
        status: input.status,
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.data === undefined ? {} : { data: input.data }),
      },
    );
  }

  /**
   * `POST /v1/widget/conversations/{id}/read` — persist how far the visitor
   * has read.
   *
   * The DURABLE half of a read receipt, and none of the four mobile SDKs had
   * it: only the web widget ever called this route. `ChatlyWidget` and
   * `ChatlyProvider` both render the unread badge from the server's own
   * `unreadContactCount`, so without this the count could only go UP — it
   * survived app restarts, and the agent inbox never learned a native
   * visitor had seen the thread.
   *
   * Distinct from the realtime "Read ✓" tick, which is advisory and goes
   * with the socket. This is the row.
   *
   * `upToMessageId` is optional server-side: omitting it means "read as of
   * now", which is what an app that does not track per-message visibility
   * should send.
   */
  public async markRead(conversationId: string, upToMessageId?: string): Promise<void> {
    await this.post<unknown>(
      `/v1/widget/conversations/${encodeURIComponent(conversationId)}/read`,
      {
        publicId: this.publicId,
        visitorToken: (await this.getToken()) ?? '',
        ...(upToMessageId === undefined ? {} : { upToMessageId }),
      },
    );
  }

  /**
   * Remove a conversation from THIS visitor's list. Not a delete: the
   * workspace keeps the record, and a newer message brings the thread back.
   */
  public async dismiss(conversationId: string): Promise<void> {
    await this.post<unknown>(
      `/v1/widget/conversations/${encodeURIComponent(conversationId)}/dismiss`,
      {
        publicId: this.publicId,
        visitorToken: (await this.getToken()) ?? '',
      },
    );
  }

  /**
   * The audience profile this visitor matches now, resolved by the server
   * (`POST /v1/widget/profile/resolve`): starter prompts, quick links, copy.
   * `locale` defaults to the one `init` reported.
   */
  public async resolveProfile(locale?: string): Promise<ProfileView> {
    return this.post<ProfileView>('/v1/widget/profile/resolve', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      locale: locale ?? this.configLocale ?? deviceLocale(),
    });
  }

  /** A `step` card action: ask for the first step of a flow and post it. */
  public async requestCanvasStep(
    conversationId: string,
    canvasId: string,
    params?: Record<string, unknown>,
  ): Promise<{ messageId: string; canvas: unknown; hostEvent?: unknown }> {
    return this.post<{ messageId: string; canvas: unknown; hostEvent?: unknown }>(
      `/v1/widget/conversations/${encodeURIComponent(conversationId)}/canvas-step`,
      {
        publicId: this.publicId,
        visitorToken: (await this.getToken()) ?? '',
        canvasId,
        ...(params === undefined ? {} : { params }),
      },
    );
  }

  /**
   * Submit a canvas step.
   *
   * `errors` comes back keyed by field name when the server refuses, and the
   * canvas comes back either way — a refused submission returns the SAME
   * canvas with messages on it, which is why the renderer replaces what it
   * holds rather than keeping its own copy.
   */
  public async submitCanvas(
    conversationId: string,
    input: { messageId: string; actionId: string; values: Record<string, unknown> },
  ): Promise<{ canvas: unknown; errors: Record<string, string>; hostEvent?: unknown }> {
    return this.post<{ canvas: unknown; errors: Record<string, string>; hostEvent?: unknown }>(
      `/v1/widget/conversations/${encodeURIComponent(conversationId)}/canvas`,
      {
        publicId: this.publicId,
        visitorToken: (await this.getToken()) ?? '',
        messageId: input.messageId,
        actionId: input.actionId,
        values: input.values,
      },
    );
  }

  /**
   * Mint a realtime token for ONE conversation.
   *
   * This is the credential the Socket.IO gateway accepts from a visitor —
   * HS256, conversation-scoped, 1h TTL. The long-lived `session.token` from
   * `init` is NOT accepted there: a handshake carrying it is verified as an
   * agent token (RS256, platform public key) and refused with a bare
   * `Unauthorized`. See `RealtimeClient`.
   *
   * 404s when the conversation is not this visitor's own — the mint checks
   * `conv.contactId === session.contactId` server-side.
   */
  public async mintRealtimeToken(
    conversationId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    return this.post<{ token: string; expiresAt: string }>('/v1/widget/realtime/token', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      conversationId,
    });
  }

  /**
   * Upload a file and return the attachment a message carries.
   *
   * THREE steps, and the first one is the one this got wrong for its whole
   * life. It used to post `{ filename, mimeType, data }` — a base64 blob — to
   * the presign route, which accepts
   * `{ visitorToken, publicId, filename, contentType, sizeBytes }` and takes
   * no bytes at all. zod dropped `mimeType` and `data` as unknown keys and
   * answered 400 on the missing `contentType`, so no attachment ever uploaded
   * from this SDK.
   *
   *   1. presign — the API mints the key under `workspaces/<id>/…`, so the
   *      visitor cannot choose where their file lands;
   *   2. the bytes go STRAIGHT to object storage with the returned method and
   *      headers. Not multipart, not base64. Proxying a 10 MiB file through
   *      Node to write it to S3 anyway is latency and memory for nothing;
   *   3. the attachment record, which renames `contentType` to `mimeType` —
   *      the same string under two names, because that is what the two
   *      schemas call it (`widgetPresignSchema` vs `widgetAttachmentSchema`).
   *
   * The route refuses before presigning on three conditions — attachments off
   * for the channel, a MIME type outside `WIDGET_UPLOAD_MIME`, a file over the
   * channel's cap — each with copy written for the visitor to read. Those
   * arrive as a `ChatlyRequestError` whose `message` is the server's own, so a
   * composer can render it as-is. Do not pre-check the size here: the cap is
   * per channel and the server owns it.
   */
  public async uploadAttachment(input: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
  }): Promise<Attachment> {
    const sizeBytes = input.bytes.byteLength;
    const presigned = await this.post<{
      uploadId: string;
      url: string;
      method: string;
      headers: Record<string, string>;
      publicUrl: string;
      expiresAt: string;
    }>('/v1/widget/uploads/presign', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      filename: input.filename,
      // `contentType` on the way in, `mimeType` on the way out. Same string.
      contentType: input.mimeType,
      sizeBytes,
    });

    /*
     * Dev fallback: no object storage configured. The API answers with a
     * `data:` sentinel rather than a real URL, and PUTting to it would throw a
     * confusing network error. Same guard as `uploadOne` in the web widget.
     */
    if (presigned.url.startsWith('data:')) {
      throw new Error('File uploads are not configured on this deployment');
    }

    const res = await fetch(presigned.url, {
      method: presigned.method,
      headers: presigned.headers,
      // The bytes. A typed array is a valid `fetch` body in React Native and
      // in every runtime this package is tested on.
      body: input.bytes as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new Error(`[chatly] upload failed: ${res.status}`);
    }

    return {
      id: presigned.uploadId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes,
      url: presigned.publicUrl,
    };
  }

  public async listConversations(limit = 20): Promise<{ conversations: ConversationSummary[] }> {
    return this.post<{ conversations: ConversationSummary[] }>('/v1/widget/conversations/list', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      limit,
    });
  }

  public async listMessages(
    conversationId: string,
    limit = 50,
  ): Promise<{ messages: MessageRow[] }> {
    return this.post<{ messages: MessageRow[] }>('/v1/widget/messages/list', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      conversationId,
      limit,
    });
  }

  public async searchKb(query: string, limit = 8): Promise<{ results: KbResult[] }> {
    return this.post<{ results: KbResult[] }>('/v1/widget/kb/search', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? undefined,
      query,
      limit,
    });
  }

  public async getKbArticle(slug: string): Promise<{ article: KbArticle }> {
    return this.post<{ article: KbArticle }>('/v1/widget/kb/article', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? undefined,
      slug,
    });
  }

  public async registerPushToken(input: {
    platform: 'apns' | 'fcm' | 'web-push';
    token: string;
    appVersion?: string;
  }): Promise<{ id: string; created: boolean }> {
    const visitorToken = await this.getToken();
    if (visitorToken === null) {
      throw new Error('[chatly] cannot register push token before init()');
    }
    return this.post<{ id: string; created: boolean }>('/v1/widget/push/register', {
      publicId: this.publicId,
      visitorToken,
      platform: input.platform,
      token: input.token,
      ...(input.appVersion !== undefined ? { appVersion: input.appVersion } : {}),
    });
  }

  /**
   * @param idempotencyKey minted once per logical call and REUSED on the
   *   stale-session replay below, so a replayed write coalesces server-side
   *   instead of double-sending.
   * @param isRetry set only by `recoverSession`, to bound recovery to a
   *   single attempt. A second refusal is a real error and is thrown.
   */
  private async post<T>(
    path: string,
    body: unknown,
    idempotencyKey?: string,
    isRetry = false,
  ): Promise<T> {
    const key = idempotencyKey ?? newIdempotencyKey();
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await safeText(res);
      if (res.status === 403 && !isRetry && isStaleSession(text)) {
        return this.recoverSession<T>(path, body, key);
      }
      throw ChatlyRequestError.from(path, res.status, text);
    }
    return (await res.json()) as T;
  }

  /**
   * The server refused the token in this device's storage. Get a new one and
   * replay the call, once.
   *
   * This is what a mid-session mobile visitor hits on the deploy that closes
   * the identity-verification bypass: the token in the token store predates
   * signed visitor sessions, and on a channel with verification enabled it is
   * refused rather than honoured. Without this the app surfaces one failed
   * send and only self-heals on the NEXT launch, because the dead token stays
   * on disk. Handled here rather than surfaced, because from the visitor's
   * side nothing has gone wrong.
   *
   * The dead token is cleared from the token store, not just the in-memory
   * cache — otherwise the next launch repeats the failure.
   */
  private async recoverSession<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    const retry = { ...(body as Record<string, unknown>) };
    const identity = await this.rememberedIdentity();
    await this.dropToken();
    if (path === '/v1/widget/init') {
      // Re-boot in place: drop the dead token and keep whatever identity the
      // caller asked for, falling back to the remembered one.
      delete retry['visitorToken'];
      if (retry['identity'] === undefined && identity !== undefined) {
        retry['identity'] = identity;
      }
    } else {
      await this.init(identity);
      retry['visitorToken'] = this.tokenCache ?? '';
    }
    return this.post<T>(path, retry, idempotencyKey, true);
  }
}

/**
 * Does this 403 mean "your session token is no good", as opposed to any of
 * the other things a widget call can be forbidden for (a disallowed origin, a
 * missing identity hash)? Only the session codes are cured by fetching a new
 * token; retrying the others would just fail again, more slowly.
 *
 * Both `visitor_session_upgrade_required` and `visitor_session_invalid` are
 * matched by prefix, so a future third session code recovers for free.
 */
function isStaleSession(responseText: string): boolean {
  /*
   * Reads the code through `readErrorBody`, which handles the NESTING: the API
   * ends with `send({ error: body })`, so a refusal is
   * `{ error: { code, ... } }`. This used to read `body.code` at the top level
   * itself, which is `undefined` for every real response — so it returned
   * false every time and the recovery below never fired. A visitor holding an
   * expired token got the failures this client was written to absorb.
   *
   * The third place with that exact bug: the widget (fixed 2026-10-08),
   * `sdk-js`, and here. Each was written by reading the previous one. One
   * parser now, so a fourth reading cannot drift from it.
   */
  const code = readErrorBody(responseText).code;
  return code !== null && code.startsWith('visitor_session_');
}

/**
 * Lightweight UUID-ish token for the `Idempotency-Key` header. RN has
 * `crypto.randomUUID` on modern Hermes builds but it's not universal — fall
 * back to a time + random hex string when missing.
 */
function newIdempotencyKey(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID !== undefined) {
    return g.crypto.randomUUID();
  }
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e16).toString(36);
  return `rn-${t}-${r}`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
