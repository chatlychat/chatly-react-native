/**
 * The React Native SDK's realtime wire protocol.
 *
 * ── Round one: the channel names ───────────────────────────────────────────
 *
 * Every channel name here was wrong, so the whole surface was inert — for
 * every integrator, silently:
 *
 *   - it LISTENED on 'envelope'; the gateway EMITS on 'event', so nothing
 *     ever arrived;
 *   - it EMITTED subscribe on 'envelope'; the gateway LISTENS on 'subscribe',
 *     so no subscription was ever registered;
 *   - it wrapped the subscribe payload in a RealtimeEnvelope; the gateway
 *     parses the BARE `{ channels, lastEventId? }` with `subscribePayloadSchema`,
 *     so even on the right channel it would have answered validation_failed.
 *
 * ── Round two: the handshake, which is why none of that mattered ───────────
 *
 * The socket never authenticated at all. The handshake sent
 * `{ token, workspaceId, contactId }` with the LONG-LIVED session token from
 * `/v1/widget/init`, and `apps/realtime/src/gateway.ts:54-59` accepts exactly
 * `{ token, kind? }` where `kind` DEFAULTS TO AGENT — so the gateway verified
 * a visitor's HS256 token as RS256 against the platform public key, failed,
 * and answered a bare `Unauthorized` naming neither credential.
 *
 * These are request-side tests on purpose. A fake transport that answers
 * every route with whatever the SDK asked for agrees with the bug; the only
 * half it cannot fake is what the SDK SENT.
 *
 * Ground truth: `docs/prompts/5/mobile-sdk-visitor-contract.md` §1, and
 * `apps/widget/src/realtime-client.ts:68-102` for the reference client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionState } from './types';

interface Emitted {
  channel: string;
  payload: unknown;
}

interface Opened {
  url: string;
  opts: Record<string, unknown>;
}

const emitted: Emitted[] = [];
const handlers = new Map<string, (arg: unknown) => void>();
const opened: Opened[] = [];
const disconnected: number[] = [];

vi.mock('socket.io-client', () => ({
  io: (url: string, opts: Record<string, unknown>) => {
    opened.push({ url, opts });
    const index = opened.length - 1;
    return {
      // `subscribe()` gates on `socket.connected`, exactly as socket.io-client
      // exposes it — a mock without this silently emits nothing.
      connected: true,
      on: (channel: string, fn: (arg: unknown) => void) => {
        handlers.set(channel, fn);
      },
      emit: (channel: string, payload: unknown) => {
        emitted.push({ channel, payload });
      },
      removeAllListeners: vi.fn(),
      disconnect: () => {
        disconnected.push(index);
      },
      close: vi.fn(),
    };
  },
}));

const { RealtimeClient } = await import('./RealtimeClient.js');

const SESSION: SessionState = {
  // The credential that must NOT reach the gateway.
  token: 'visitor-session-token',
  contactId: 'c-1',
  workspaceId: 'ws-1',
  brandId: 'b-1',
  channelId: 'ch-1',
};

let mints = 0;
let mintedFor: string[] = [];

/** Stands in for `RestClient.mintRealtimeToken` — `POST /v1/widget/realtime/token`. */
async function mintToken(conversationId: string): Promise<{ token: string; expiresAt: string }> {
  mints += 1;
  mintedFor.push(conversationId);
  return {
    token: `realtime-token-${conversationId}-${mints}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

beforeEach(() => {
  emitted.length = 0;
  opened.length = 0;
  disconnected.length = 0;
  handlers.clear();
  mints = 0;
  mintedFor = [];
});

async function connected(conversationId = 'conv-1'): Promise<InstanceType<typeof RealtimeClient>> {
  const c = new RealtimeClient({ publicId: 'pub_test', apiHost: 'api.test' });
  await c.connect({ session: SESSION, conversationId, mintToken });
  return c;
}

/**
 * The handshake payload the gateway would actually receive.
 *
 * Reads it by INVOKING the auth hook, which is the only way a per-attempt
 * callback can be inspected — and asserting it is a callback at all is half
 * the point of this file.
 */
function handshakeAuth(index = opened.length - 1): Record<string, unknown> {
  const auth = opened[index]?.opts['auth'];
  if (typeof auth !== 'function') {
    throw new Error(
      `auth must be a per-attempt callback so a reconnect re-reads the token; got ${typeof auth}`,
    );
  }
  const seen: Array<Record<string, unknown>> = [];
  (auth as (cb: (data: Record<string, unknown>) => void) => void)((data) => {
    seen.push(data);
  });
  const payload = seen[0];
  if (payload === undefined) {
    throw new Error('the auth callback never invoked its own callback');
  }
  return payload;
}

describe('the visitor handshake', () => {
  it("carries kind: 'visitor', without which the gateway verifies it as an agent", async () => {
    await connected();
    expect(handshakeAuth()['kind']).toBe('visitor');
  });

  it('carries a token minted by /v1/widget/realtime/token, not the session token', async () => {
    await connected('conv-1');
    expect(mintedFor).toEqual(['conv-1']);
    expect(handshakeAuth()['token']).toBe('realtime-token-conv-1-1');
    expect(handshakeAuth()['token']).not.toBe(SESSION.token);
  });

  it('sends nothing else — the gateway schema is { token, kind? }', async () => {
    await connected();
    expect(Object.keys(handshakeAuth()).sort()).toEqual(['kind', 'token']);
  });

  it('re-reads the auth payload on a second attempt, with a re-minted token', async () => {
    await connected('conv-1');
    expect(handshakeAuth()['token']).toBe('realtime-token-conv-1-1');

    // The socket dropped. socket.io will retry on its own backoff; the token
    // it retries WITH is the whole bug — a 1h TTL outlives plenty of mobile
    // sessions, and a frozen credential is refused silently forever after.
    handlers.get('disconnect')?.('transport close');
    await vi.waitFor(() => {
      expect(mints).toBe(2);
    });

    expect(handshakeAuth()['token']).toBe('realtime-token-conv-1-2');
    expect(handshakeAuth()['kind']).toBe('visitor');
  });
});

describe('conversation scope', () => {
  it('re-mints and reconnects on a switch — the token names one conversation', async () => {
    const c = await connected('conv-1');
    await c.connect({ session: SESSION, conversationId: 'conv-2', mintToken });

    expect(mintedFor).toEqual(['conv-1', 'conv-2']);
    // The first socket is gone: reusing it would deliver conv-1's events.
    expect(disconnected).toContain(0);
    expect(opened).toHaveLength(2);
    expect(handshakeAuth(1)['token']).toBe('realtime-token-conv-2-2');
  });

  it('stands down rather than opening a socket nobody owns', async () => {
    // disconnect() landing while the mint is in flight must not be undone by
    // the mint's completion — the widget client guards the same window.
    const c = new RealtimeClient({ publicId: 'pub_test', apiHost: 'api.test' });
    const pending = c.connect({ session: SESSION, conversationId: 'conv-1', mintToken });
    c.disconnect();
    await pending;
    expect(opened).toHaveLength(0);
  });
});

describe('inbound channel', () => {
  it('listens on the channel the gateway emits — "event"', async () => {
    await connected();
    expect(handlers.has('event')).toBe(true);
  });

  it('no longer listens on "envelope", which the server never emits', async () => {
    await connected();
    expect(handlers.has('envelope')).toBe(false);
  });

  it('delivers a received envelope to a subscriber', async () => {
    const c = await connected();
    const seen: unknown[] = [];
    c.on('message.created', (e) => void seen.push(e));
    handlers.get('event')?.({
      v: 1,
      type: 'message.created',
      id: '01000000-0000-7000-8000-000000000001',
      ts: Date.now(),
      workspace_id: 'ws-1',
      payload: { body: 'hi' },
    });
    expect(seen).toHaveLength(1);
  });
});

describe('subscribe frame', () => {
  it('emits on "subscribe", the channel the gateway listens on', async () => {
    const c = await connected();
    c.subscribe(['conversation:1']);
    expect(emitted.map((e) => e.channel)).toContain('subscribe');
  });

  it('never emits on "envelope"', async () => {
    const c = await connected();
    c.subscribe(['conversation:1']);
    expect(emitted.map((e) => e.channel)).not.toContain('envelope');
  });

  it('sends the BARE payload the server parses, not an envelope', async () => {
    const c = await connected();
    c.subscribe(['conversation:1']);
    const frame = emitted.find((e) => e.channel === 'subscribe')?.payload as Record<
      string,
      unknown
    >;
    expect(frame['channels']).toEqual(['conversation:1']);
    // An envelope would carry these; the schema rejects unknown top-level keys.
    expect(frame['v']).toBeUndefined();
    expect(frame['type']).toBeUndefined();
    expect(frame['workspace_id']).toBeUndefined();
  });

  it('omits lastEventId until something has actually been received', async () => {
    const c = await connected();
    c.subscribe(['conversation:1']);
    const frame = emitted.find((e) => e.channel === 'subscribe')?.payload as Record<
      string,
      unknown
    >;
    expect('lastEventId' in frame).toBe(false);
  });

  it('replays from the last envelope id once one has arrived', async () => {
    // The cursor must be a real server-issued uuidv7 — the client used to
    // mint its own id, which the server cannot resolve.
    const c = await connected();
    const id = '01000000-0000-7000-8000-0000000000ab';
    handlers.get('event')?.({
      v: 1,
      type: 'message.created',
      id,
      ts: Date.now(),
      workspace_id: 'ws-1',
      payload: {},
    });
    c.subscribe(['conversation:1']);
    const frame = emitted.find((e) => e.channel === 'subscribe')?.payload as Record<
      string,
      unknown
    >;
    expect(frame['lastEventId']).toBe(id);
  });

  it('re-subscribes on reconnect', async () => {
    const c = await connected();
    c.subscribe(['conversation:1']);
    emitted.length = 0;
    handlers.get('connect')?.(undefined);
    expect(emitted.filter((e) => e.channel === 'subscribe')).toHaveLength(1);
  });
});
