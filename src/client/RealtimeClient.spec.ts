/**
 * The React Native SDK's realtime wire protocol.
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
 * Nothing failed loudly. The socket connected, the SDK reported itself
 * healthy, and no message ever appeared.
 *
 * These pin the protocol against the server's own definitions.
 */
import { describe, expect, it, vi } from 'vitest';

interface Emitted {
  channel: string;
  payload: unknown;
}

const emitted: Emitted[] = [];
const handlers = new Map<string, (arg: unknown) => void>();

vi.mock('socket.io-client', () => ({
  io: () => ({
    // `subscribe()` gates on `socket.connected`, exactly as socket.io-client
    // exposes it — a mock without this silently emits nothing.
    connected: true,
    on: (channel: string, fn: (arg: unknown) => void) => {
      handlers.set(channel, fn);
    },
    emit: (channel: string, payload: unknown) => {
      emitted.push({ channel, payload });
    },
    disconnect: vi.fn(),
    close: vi.fn(),
  }),
}));

const { RealtimeClient } = await import('./RealtimeClient.js');

const SESSION = { workspaceId: 'ws-1', contactId: 'c-1' } as never;

function connected(): InstanceType<typeof RealtimeClient> {
  emitted.length = 0;
  handlers.clear();
  const c = new RealtimeClient({ apiHost: 'api.test' } as never);
  c.connect(SESSION, 'tok');
  return c;
}

describe('inbound channel', () => {
  it('listens on the channel the gateway emits — "event"', () => {
    connected();
    expect(handlers.has('event')).toBe(true);
  });

  it('no longer listens on "envelope", which the server never emits', () => {
    connected();
    expect(handlers.has('envelope')).toBe(false);
  });

  it('delivers a received envelope to a subscriber', () => {
    const c = connected();
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
  it('emits on "subscribe", the channel the gateway listens on', () => {
    const c = connected();
    c.subscribe(['conversation:1']);
    expect(emitted.map((e) => e.channel)).toContain('subscribe');
  });

  it('never emits on "envelope"', () => {
    const c = connected();
    c.subscribe(['conversation:1']);
    expect(emitted.map((e) => e.channel)).not.toContain('envelope');
  });

  it('sends the BARE payload the server parses, not an envelope', () => {
    const c = connected();
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

  it('omits lastEventId until something has actually been received', () => {
    const c = connected();
    c.subscribe(['conversation:1']);
    const frame = emitted.find((e) => e.channel === 'subscribe')?.payload as Record<
      string,
      unknown
    >;
    expect('lastEventId' in frame).toBe(false);
  });

  it('replays from the last envelope id once one has arrived', () => {
    // The cursor must be a real server-issued uuidv7 — the client used to
    // mint its own id, which the server cannot resolve.
    const c = connected();
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

  it('re-subscribes on reconnect', () => {
    const c = connected();
    c.subscribe(['conversation:1']);
    emitted.length = 0;
    handlers.get('connect')?.(undefined);
    expect(emitted.filter((e) => e.channel === 'subscribe')).toHaveLength(1);
  });
});
