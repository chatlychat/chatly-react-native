/**
 * Stale-session recovery for the React Native SDK.
 *
 * When visitor tokens became signed envelopes, the server began refusing
 * pre-signature tokens with a 403 carrying `visitor_session_upgrade_required`
 * (or `visitor_session_invalid`). The browser widget and `@chatlychat/sdk-js`
 * both recover from that in place; the mobile SDKs did not, so a mid-session
 * visitor on an IDV-enabled channel got one hard failure and then kept
 * failing, because the dead token stayed in AsyncStorage across launches.
 *
 * These pin the recovery to the widget's exact semantics:
 *   - only a 403, and only for `visitor_session_*` codes;
 *   - exactly one retry;
 *   - the replay re-inits with the REMEMBERED identity, so the contact — and
 *     therefore the conversation history — comes back;
 *   - the dead token is replaced in PERSISTENT storage, not just in memory;
 *   - the Idempotency-Key is stable across the replay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

/**
 * The REAL `@react-native-async-storage/async-storage` is used here, not a
 * stub of `TokenStore`: outside a device its entry point is the web build,
 * which is a thin shim over `window.localStorage`. Backing that with a Map
 * exercises the whole persistence path the SDK actually runs — which is the
 * point, since the bug being fixed is a dead token surviving on DISK.
 *
 * `TokenStore` loads the module with `require()`, which vite-node resolves
 * outside the mock registry, so `vi.mock` on it would not take effect anyway.
 */
const store = new Map<string, string>();

vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      store.set(k, v);
    },
    removeItem: (k: string): void => {
      store.delete(k);
    },
    clear: (): void => {
      store.clear();
    },
  },
});

import { RestClient } from './RestClient';

import type { ChatlyIdentity } from './types';

const PUBLIC_ID = 'pub_test';
const TOKEN_KEY = `chatly:vt:${PUBLIC_ID}`;
const IDENTITY_KEY = `chatly:id:${PUBLIC_ID}`;

interface Call {
  path: string;
  body: Record<string, unknown>;
  idempotencyKey: string | null;
}

const calls: Call[] = [];

function record(url: string, init: RequestInit): Call {
  const headers = (init.headers ?? {}) as Record<string, string>;
  const call: Call = {
    path: new URL(url).pathname,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    idempotencyKey: headers['idempotency-key'] ?? null,
  };
  calls.push(call);
  return call;
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function initPayload(token: string): unknown {
  return {
    session: {
      token,
      contactId: 'c-1',
      workspaceId: 'w-1',
      brandId: 'b-1',
      channelId: 'ch-1',
    },
    workspace: { id: 'w-1', name: 'Acme' },
    branding: {},
  };
}

const IDENTITY: ChatlyIdentity = { externalId: 'u-42', userHash: 'deadbeef' };

function newClient(): RestClient {
  return new RestClient({ publicId: PUBLIC_ID, apiHost: 'api.test' });
}

/** Puts a (now stale) token and a remembered identity on "disk", exactly as a
 *  previous app launch would have left them. */
function seedDisk(): void {
  store.set(TOKEN_KEY, 'stale-token');
  store.set(IDENTITY_KEY, JSON.stringify(IDENTITY));
}

beforeEach(() => {
  calls.length = 0;
  store.clear();
});

describe('RestClient stale-session recovery', () => {
  it('replays the call once after re-initing with the remembered identity', async () => {
    seedDisk();
    let repliesSeen = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const call = record(url, init);
        if (call.path === '/v1/widget/init') {
          return Promise.resolve(json(200, initPayload('fresh-token')));
        }
        repliesSeen += 1;
        if (repliesSeen === 1) {
          return Promise.resolve(json(403, { code: 'visitor_session_upgrade_required' }));
        }
        return Promise.resolve(json(200, { message: { id: 'm-1' } }));
      }),
    );

    const client = newClient();
    await expect(client.reply('conv-1', 'hello')).resolves.toEqual({ message: { id: 'm-1' } });

    // Exactly two calls to the original endpoint, one init wedged between.
    expect(calls.map((c) => c.path)).toEqual([
      '/v1/widget/messages',
      '/v1/widget/init',
      '/v1/widget/messages',
    ]);

    // The re-init carried the remembered identity, so the replay lands on the
    // same contact and the visitor's history survives.
    expect(calls[1]?.body['identity']).toEqual(IDENTITY);
    // ...and did NOT re-send the token the server just refused.
    expect(calls[1]?.body['visitorToken']).toBeUndefined();

    // The replay used the fresh token.
    expect(calls[0]?.body['visitorToken']).toBe('stale-token');
    expect(calls[2]?.body['visitorToken']).toBe('fresh-token');

    // A replayed write must coalesce server-side, not double-send.
    expect(calls[2]?.idempotencyKey).toBe(calls[0]?.idempotencyKey);
    expect(calls[2]?.idempotencyKey).not.toBe(calls[1]?.idempotencyKey);

    // Persisted, not just cached: the next launch must not repeat the failure.
    expect(store.get(TOKEN_KEY)).toBe('fresh-token');
  });

  it('recovers `visitor_session_invalid` too, not just the upgrade code', async () => {
    seedDisk();
    let repliesSeen = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const call = record(url, init);
        if (call.path === '/v1/widget/init') {
          return Promise.resolve(json(200, initPayload('fresh-token')));
        }
        repliesSeen += 1;
        return repliesSeen === 1
          ? Promise.resolve(json(403, { code: 'visitor_session_invalid' }))
          : Promise.resolve(json(200, { ok: true }));
      }),
    );

    const client = newClient();
    await expect(client.reply('conv-1', 'hello')).resolves.toEqual({ ok: true });
    expect(calls.filter((c) => c.path === '/v1/widget/messages')).toHaveLength(2);
  });

  it('re-boots init in place when init itself is refused', async () => {
    seedDisk();
    let initsSeen = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        record(url, init);
        initsSeen += 1;
        return initsSeen === 1
          ? Promise.resolve(json(403, { code: 'visitor_session_invalid' }))
          : Promise.resolve(json(200, initPayload('fresh-token')));
      }),
    );

    const client = newClient();
    await client.init();

    expect(calls.map((c) => c.path)).toEqual(['/v1/widget/init', '/v1/widget/init']);
    expect(calls[0]?.body['visitorToken']).toBe('stale-token');
    expect(calls[1]?.body['visitorToken']).toBeUndefined();
    expect(calls[1]?.body['identity']).toEqual(IDENTITY);
    expect(store.get(TOKEN_KEY)).toBe('fresh-token');
  });

  it('does NOT retry a 403 with an unrelated code', async () => {
    seedDisk();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        record(url, init);
        return Promise.resolve(json(403, { code: 'widget_origin_not_allowed' }));
      }),
    );

    const client = newClient();
    await expect(client.reply('conv-1', 'hello')).rejects.toThrow(/403/);

    // One attempt, no init: retrying an origin refusal just fails again.
    expect(calls.map((c) => c.path)).toEqual(['/v1/widget/messages']);
    // The token was NOT thrown away — it was never the problem.
    expect(store.get(TOKEN_KEY)).toBe('stale-token');
  });

  it('gives up after exactly one retry when the replay is refused too', async () => {
    seedDisk();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const call = record(url, init);
        return call.path === '/v1/widget/init'
          ? Promise.resolve(json(200, initPayload('fresh-token')))
          : Promise.resolve(json(403, { code: 'visitor_session_invalid' }));
      }),
    );

    const client = newClient();
    await expect(client.reply('conv-1', 'hello')).rejects.toThrow(/403/);
    expect(calls.filter((c) => c.path === '/v1/widget/messages')).toHaveLength(2);
  });

  it('does not retry a non-403 failure', async () => {
    seedDisk();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        record(url, init);
        return Promise.resolve(json(500, { code: 'visitor_session_invalid' }));
      }),
    );

    const client = newClient();
    await expect(client.reply('conv-1', 'hello')).rejects.toThrow(/500/);
    expect(calls).toHaveLength(1);
  });

  it('persists the identity only after the server accepts it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        record(url, init);
        return Promise.resolve(json(200, initPayload('fresh-token')));
      }),
    );

    const client = newClient();
    expect(store.get(IDENTITY_KEY)).toBeUndefined();
    await client.init(IDENTITY);
    expect(JSON.parse(store.get(IDENTITY_KEY) ?? 'null')).toEqual(IDENTITY);
  });

  it('forgets the remembered identity on clearToken, so logout cannot be undone by a recovery', async () => {
    seedDisk();
    const client = newClient();
    await client.clearToken();
    expect(store.get(TOKEN_KEY)).toBeUndefined();
    expect(store.get(IDENTITY_KEY)).toBeUndefined();
  });
});

/**
 * The envelope the API really sends.
 *
 * Every fixture above uses `{ code }` at the top level, and the API has never
 * sent that: `app-exception.filter.ts` ends with `send({ error: body })`. So
 * `isStaleSession` read `undefined`, returned false every time, and the
 * recovery this whole file is about never fired in production — the suite was
 * green because the fixtures agreed with the bug rather than with the server.
 *
 * Third place with the identical defect: the browser widget, `sdk-js`, and
 * here. Each was written by reading the previous one, which is how a bug
 * travels between SDKs that look independent.
 */
describe('the real error envelope', () => {
  it('recovers a stale session from a NESTED 403', async () => {
    seedDisk();
    let repliesSeen = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const call = record(url, init);
        if (call.path === '/v1/widget/init') {
          return Promise.resolve(json(200, initPayload('fresh-token')));
        }
        repliesSeen += 1;
        if (repliesSeen === 1) {
          return Promise.resolve(
            json(403, { error: { code: 'visitor_session_upgrade_required', message: 'stale' } }),
          );
        }
        return Promise.resolve(json(200, { ok: true }));
      }),
    );
    await newClient().listConversations();
    // Refused once, re-initialised with the remembered identity, replayed.
    expect(calls.filter((c) => c.path === '/v1/widget/conversations/list')).toHaveLength(2);
    expect(calls.some((c) => c.path === '/v1/widget/init')).toBe(true);
  });

  it('still does NOT retry a nested non-session 403', async () => {
    // An origin refusal fails identically on a retry; retrying is just
    // slower. Reading the nested code must not make every 403 recoverable.
    seedDisk();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const call = record(url, init);
        if (call.path === '/v1/widget/init') {
          return Promise.resolve(json(200, initPayload('fresh-token')));
        }
        return Promise.resolve(json(403, { error: { code: 'forbidden', message: 'nope' } }));
      }),
    );
    await expect(newClient().listConversations()).rejects.toThrow();
    expect(calls.filter((c) => c.path === '/v1/widget/conversations/list')).toHaveLength(1);
  });
});

/**
 * `apiUrl`, which every other client in this product already takes.
 *
 * `createChatlyCore`, the identity endpoints and the backend SDKs all accept a
 * URL, so a host that already held one had to take it apart into
 * `apiHost` + `secure` for this package alone. Crossly's round 2.
 */
describe('apiUrl', () => {
  it('wins over apiHost and secure', () => {
    const c = new RestClient({
      publicId: PUBLIC_ID,
      apiUrl: 'https://api.chatlychat.com',
      apiHost: 'ignored.test',
      secure: false,
    });
    expect(c.baseUrl).toBe('https://api.chatlychat.com');
  });

  it('trims a trailing slash, which would make a // path', () => {
    // `${apiUrl}/v1/...` with a trailing slash gives `//v1/...`, which some
    // proxies answer 404 to rather than normalising.
    const c = new RestClient({ publicId: PUBLIC_ID, apiUrl: 'https://api.test/' });
    expect(c.baseUrl).toBe('https://api.test');
  });

  it('leaves the apiHost path working for every existing app', () => {
    expect(new RestClient({ publicId: PUBLIC_ID, apiHost: 'api.test' }).baseUrl).toBe(
      'https://api.test',
    );
    expect(
      new RestClient({ publicId: PUBLIC_ID, apiHost: 'api.test', secure: false }).baseUrl,
    ).toBe('http://api.test');
  });

  it('defaults to Chatly, not to somebody else', () => {
    // `api.chatly.com` shipped as the default in 0.1.1 — a real host owned by
    // a third party, which every app that omitted `apiHost` sent its visitor
    // sessions to. The gate that missed it only looked for dev-shaped names.
    expect(new RestClient({ publicId: PUBLIC_ID }).baseUrl).toBe('https://api.chatlychat.com');
  });
});
