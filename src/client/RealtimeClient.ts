/**
 * Socket.IO realtime client for a VISITOR socket.
 *
 * ── The credential, and why there are two of them ──────────────────────────
 *
 * A visitor has two tokens and they are not interchangeable:
 *
 *   - `session.token` from `POST /v1/widget/init` — long-lived, identifies
 *     the visitor, and carried in the BODY of every REST call. The realtime
 *     gateway does not accept it.
 *   - a realtime token from `POST /v1/widget/realtime/token` — HS256,
 *     scoped to ONE conversation, 1h TTL. This is the one the socket wants.
 *
 * This client used to hand the gateway the session token with a handshake of
 * `{ token, workspaceId, contactId }`. `handshakeAuthSchema`
 * (`apps/realtime/src/gateway.ts:54-59`) is `{ token, kind? }` and `kind`
 * DEFAULTS TO AGENT, so the gateway verified a visitor's HS256 token as RS256
 * against the platform public key, failed, and answered a bare `Unauthorized`
 * naming neither credential. Two wrong things pointing the same way: realtime
 * never worked in this SDK, for anyone, and failed without saying why.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 *
 * The token names one conversation, and the gateway joins the socket to
 * `v:<workspace>:<conversation>` from the token's own claim — it does not read
 * a subscribe frame from a visitor at all. So a conversation switch is a
 * re-mint and a reconnect, not a second subscribe; reusing the socket would
 * keep delivering the previous conversation's events.
 */

import { io, type Socket } from 'socket.io-client';

import type {
  ChatlyConfig,
  MessageCreatedPayload,
  RealtimeEnvelope,
  RealtimeEventType,
  SessionState,
} from './types';

type Listener<P = unknown> = (envelope: RealtimeEnvelope<P>) => void;

/**
 * Socket.IO channel names, as the gateway actually speaks them.
 *
 * Both of these were `'envelope'`, which matches nothing the server does:
 * `apps/realtime/src/gateway.ts` EMITS on `'event'` and LISTENS on
 * `'subscribe'`. So this client received nothing and its subscribe frame was
 * never heard — the whole realtime surface of the React Native SDK was inert,
 * silently, for every integrator.
 */
const INBOUND_EVENT_CHANNEL = 'event';
const SUBSCRIBE_CHANNEL = 'subscribe';

/** What `RestClient.mintRealtimeToken` answers. */
export interface MintedRealtimeToken {
  token: string;
  expiresAt: string;
}

/** `POST /v1/widget/realtime/token`, injected so this class holds no REST. */
export type RealtimeTokenMinter = (conversationId: string) => Promise<MintedRealtimeToken>;

export interface RealtimeConnectInput {
  session: SessionState;
  /** The conversation to scope this socket to. One token, one conversation. */
  conversationId: string;
  mintToken: RealtimeTokenMinter;
}

export class RealtimeClient {
  private socket: Socket | null = null;
  private readonly url: string;
  private readonly listeners = new Map<RealtimeEventType, Set<Listener>>();
  private lastEventId: string | null = null;
  private session: SessionState | null = null;
  private subscribedChannels: string[] = [];

  /** Latest token, so a reconnect uses a refreshed one rather than the original. */
  private currentToken: string | null = null;
  private conversationId: string | null = null;
  private minter: RealtimeTokenMinter | null = null;
  /**
   * Bumped by every `connect()` and every `disconnect()`.
   *
   * A mint is a round trip. Without this, a mint that lands after the caller
   * switched conversations (or closed the chat) would open a socket for a
   * thread nobody is looking at — the same window the widget client guards
   * with its `currentToken === null` check.
   */
  private generation = 0;

  public constructor(config: ChatlyConfig) {
    // `chatlychat.com`. See the note on DEFAULT_API_HOST in RestClient.ts —
    // this fallback had the same foreign host, in a published package.
    const host = config.realtimeHost ?? config.apiHost ?? 'api.chatlychat.com';
    const scheme = config.secure === false ? 'ws' : 'wss';
    this.url = `${scheme}://${host}`;
  }

  /**
   * Mint a conversation-scoped token and open the socket with it.
   *
   * REJECTS when the mint is refused — a 404 for a conversation that is not
   * this visitor's own, or a 403 when the channel has an origin allow-list (a
   * native app sends no `Origin`, so it passes only on a channel with no list
   * configured). Callers should treat a rejection as "live delivery is
   * unavailable, keep polling", not as a dead thread.
   */
  public async connect(input: RealtimeConnectInput): Promise<void> {
    // FIRST and synchronously: an await before this would leave the previous
    // socket alive across a conversation switch.
    this.disconnect();
    const generation = ++this.generation;
    this.session = input.session;
    this.conversationId = input.conversationId;
    this.minter = input.mintToken;

    const minted = await input.mintToken(input.conversationId);
    if (generation !== this.generation) {
      // Stood down while the mint was in flight — switched or disconnected.
      return;
    }
    this.currentToken = minted.token;

    const socket = io(this.url, {
      path: '/socket.io',
      transports: ['websocket'],
      /**
       * Evaluated per connection ATTEMPT, which is why it is a callback and
       * not an object. A static object is captured once and replayed verbatim
       * on every reconnect, so a visitor whose socket dropped after the
       * token's 1h lifetime reconnects with an expired credential and is
       * refused — silently, for the rest of the session.
       */
      auth: (cb: (data: Record<string, unknown>) => void) => {
        cb({ token: this.currentToken ?? minted.token, kind: 'visitor' });
      },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      timeout: 10_000,
    });

    socket.on('connect', () => {
      this.resubscribe();
    });

    /*
     * Re-mint on the way down, so the token is already fresh by the time
     * socket.io's backoff gets around to the next attempt. The auth callback
     * above is what makes a refreshed token reachable; this is what makes it
     * exist. Together they are the difference between a reconnect that works
     * after an hour on a train and one that is refused forever.
     */
    socket.on('disconnect', () => {
      void this.refreshToken(generation);
    });
    socket.on('connect_error', () => {
      void this.refreshToken(generation);
    });

    socket.on(INBOUND_EVENT_CHANNEL, (raw: RealtimeEnvelope) => {
      this.dispatch(raw);
    });

    this.socket = socket;
  }

  public disconnect(): void {
    // Bumped so a mint still in flight stands down rather than opening a
    // socket for a conversation nobody is looking at.
    this.generation += 1;
    this.currentToken = null;
    this.conversationId = null;
    this.minter = null;
    if (this.socket !== null) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * Channel subscriptions, for an AGENT socket.
   *
   * Kept because it is published API, but understand what it does on a
   * visitor socket: nothing. `apps/realtime/src/gateway.ts` registers the
   * `subscribe` listener on the agent connection only — a visitor's rooms come
   * from its token's `conversation_id` claim, joined server-side at connect.
   * The frame is emitted on the channel the server listens on, with the bare
   * payload its schema parses, so it is correct; it is simply ignored.
   */
  public subscribe(channels: string[]): void {
    this.subscribedChannels = Array.from(new Set([...this.subscribedChannels, ...channels]));
    if (this.socket?.connected === true) {
      this.sendSubscribe(channels);
    }
  }

  public on<P = unknown>(type: RealtimeEventType, listener: Listener<P>): () => void {
    let bucket = this.listeners.get(type);
    if (bucket === undefined) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(listener as Listener);
    return (): void => {
      bucket?.delete(listener as Listener);
    };
  }

  public onMessageCreated(listener: Listener<MessageCreatedPayload>): () => void {
    return this.on<MessageCreatedPayload>('message.created', listener);
  }

  /** The conversation this socket is scoped to, or null when not connected. */
  public get activeConversationId(): string | null {
    return this.conversationId;
  }

  private async refreshToken(generation: number): Promise<void> {
    if (generation !== this.generation) {
      return;
    }
    const conversationId = this.conversationId;
    const mint = this.minter;
    if (conversationId === null || mint === null) {
      return;
    }
    try {
      const minted = await mint(conversationId);
      if (generation !== this.generation) {
        return;
      }
      this.currentToken = minted.token;
    } catch {
      // Keep the token we hold: socket.io is going to retry on its own
      // backoff either way, and an old token has a chance where none has
      // none. A mint failure is usually the same outage as the socket drop.
    }
  }

  private dispatch(envelope: RealtimeEnvelope): void {
    if (envelope?.id !== undefined) {
      this.lastEventId = envelope.id;
    }
    const bucket = this.listeners.get(envelope.type);
    if (bucket !== undefined) {
      for (const listener of bucket) {
        try {
          listener(envelope);
        } catch {
          // Listener errors must not break the dispatch loop.
        }
      }
    }
  }

  private resubscribe(): void {
    if (this.subscribedChannels.length > 0) {
      this.sendSubscribe(this.subscribedChannels);
    }
  }

  private sendSubscribe(channels: string[]): void {
    if (this.socket === null || this.session === null) {
      return;
    }
    // The gateway parses this with `subscribePayloadSchema`, which is the BARE
    // payload — `{ channels, lastEventId? }`. It was being wrapped in a
    // RealtimeEnvelope, so even on the right channel the parse would have
    // failed and answered `validation_failed`.
    this.socket.emit(SUBSCRIBE_CHANNEL, {
      channels,
      ...(this.lastEventId !== null ? { lastEventId: this.lastEventId } : {}),
    });
  }
}
