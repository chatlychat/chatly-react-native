/**
 * Socket.IO-based realtime client. Subscribes to the contact's conversation
 * channels and re-emits typed `RealtimeEnvelope` events.
 *
 * Reconnection + replay is handled by socket.io's built-in backoff; we pass
 * `lastEventId` on subscribe so the server can replay missed envelopes
 * (durable-then-deliver, per CLAUDE.md realtime conventions).
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

export class RealtimeClient {
  private socket: Socket | null = null;
  private readonly url: string;
  private readonly listeners = new Map<RealtimeEventType, Set<Listener>>();
  private lastEventId: string | null = null;
  private session: SessionState | null = null;
  private subscribedChannels: string[] = [];

  public constructor(config: ChatlyConfig) {
    // `chatlychat.com`. See the note on DEFAULT_API_HOST in RestClient.ts —
    // this fallback had the same foreign host, in a published package.
    const host = config.realtimeHost ?? config.apiHost ?? 'api.chatlychat.com';
    const scheme = config.secure === false ? 'ws' : 'wss';
    this.url = `${scheme}://${host}`;
  }

  public connect(session: SessionState, token: string): void {
    if (this.socket !== null) {
      return;
    }
    this.session = session;
    this.socket = io(this.url, {
      transports: ['websocket'],
      auth: { token, workspaceId: session.workspaceId, contactId: session.contactId },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });

    this.socket.on('connect', () => {
      this.resubscribe();
    });

    this.socket.on(INBOUND_EVENT_CHANNEL, (raw: RealtimeEnvelope) => {
      this.dispatch(raw);
    });
  }

  public disconnect(): void {
    if (this.socket !== null) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

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
