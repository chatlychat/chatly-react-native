/**
 * Thin wrapper around the widget REST surface (see `apps/widget/src/client.ts`).
 *
 * All write endpoints accept the `publicId` + `visitorToken` in the JSON body.
 * The visitor token is persisted via `TokenStore` and rotated whenever
 * `/v1/widget/init` returns a fresh one.
 */

import { Platform } from 'react-native';

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
  StartResponse,
} from './types';

const DEFAULT_API_HOST = 'api.chatly.com';

export class RestClient {
  private readonly apiUrl: string;
  private readonly publicId: string;
  private readonly tokenStore: TokenStore;
  private readonly identityStore: IdentityStore;
  private tokenCache: string | null = null;
  /** `undefined` = not yet read from disk; `null` = read, nothing stored. */
  private identityCache: ChatlyIdentity | null | undefined = undefined;

  public constructor(config: ChatlyConfig) {
    this.publicId = config.publicId;
    const host = config.apiHost ?? DEFAULT_API_HOST;
    const scheme = config.secure === false ? 'http' : 'https';
    this.apiUrl = `${scheme}://${host}`;
    this.tokenStore = new TokenStore(config.publicId);
    this.identityStore = new IdentityStore(config.publicId);
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
      locale: 'en-US',
      timezone: 'UTC',
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
   * Uploads raw bytes to the public widget upload endpoint and returns the
   * persisted [Attachment] reference. The widget surface accepts only JSON,
   * so the bytes are base64-encoded before transport. The server enforces
   * the size cap — clients must not pre-check.
   */
  public async uploadAttachment(input: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
  }): Promise<Attachment> {
    const data = bytesToBase64(input.bytes);
    return this.post<Attachment>('/v1/widget/uploads/presign', {
      publicId: this.publicId,
      visitorToken: (await this.getToken()) ?? '',
      filename: input.filename,
      mimeType: input.mimeType,
      data,
    });
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
      throw new Error(`[chatly] ${path} failed: ${res.status} ${text}`);
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
  try {
    /*
     * The API NESTS every error: `app-exception.filter.ts` ends with
     * `send({ error: body })`, so a refusal is `{ error: { code, ... } }`.
     * This read `body.code` at the top level, which is `undefined` for every
     * real response — so it returned false every time and the recovery below
     * never fired. A visitor holding an expired token got the failures this
     * client was written to absorb.
     *
     * The third place with this exact bug: the widget (fixed 2026-10-08),
     * `sdk-js`, and here. Each was written by reading the previous one.
     */
    const body = JSON.parse(responseText) as { error?: { code?: unknown }; code?: unknown };
    const code = body.error?.code ?? body.code;
    return typeof code === 'string' && code.startsWith('visitor_session_');
  } catch {
    return false;
  }
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

/**
 * Base64-encodes a Uint8Array without pulling in `Buffer`. RN exposes
 * `globalThis.btoa` on Hermes; older builds need the manual path.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as { btoa?: (s: string) => string };
  let binary = '';
  // Chunk to avoid blowing the call stack on large fromCharCode applies.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  if (g.btoa !== undefined) {
    return g.btoa(binary);
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Every index below is the result of bit-masks that produce values in
  // [0, 63] and `chars` is exactly 64 characters long, so the lookup is always
  // defined. `charAt` says that in the type system — it returns `string`, not
  // `string | undefined` — where `chars[n]!` only asserted it past
  // `noUncheckedIndexedAccess`. Same output for every reachable index.
  const at = (n: number): string => chars.charAt(n);
  let result = '';
  let i = 0;
  for (; i + 2 < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = binary.charCodeAt(i + 1);
    const c = binary.charCodeAt(i + 2);
    result +=
      at(a >> 2) +
      at(((a & 0x03) << 4) | (b >> 4)) +
      at(((b & 0x0f) << 2) | (c >> 6)) +
      at(c & 0x3f);
  }
  if (i < binary.length) {
    const a = binary.charCodeAt(i);
    if (i + 1 === binary.length) {
      result += at(a >> 2) + at((a & 0x03) << 4) + '==';
    } else {
      const b = binary.charCodeAt(i + 1);
      result += at(a >> 2) + at(((a & 0x03) << 4) | (b >> 4)) + at((b & 0x0f) << 2) + '=';
    }
  }
  return result;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
