/**
 * `init` must report the DEVICE's locale and timezone, not a constant.
 *
 * ═══ WHY ══════════════════════════════════════════════════════════════════
 *
 * `RestClient.init` sent the literals `locale: 'en-US'` and
 * `timezone: 'UTC'`, and neither `ChatlyConfig` nor `ChatlyProviderProps` had
 * a field to override them — so an app developer could not correct it even
 * knowing it was wrong.
 *
 * Both values are STORED on the contact and branched on: help-centre language
 * negotiation, workflow locale conditions, the agent-visible local time, and
 * the device-recognition hash. So the literals were not an unset placeholder.
 * They asserted, on every native visitor, something the server had no way to
 * doubt — a German user's record said US English in UTC.
 *
 * ═══ WHY THE SUITE COULD NOT SEE IT ═══════════════════════════════════════
 *
 * `RestClient.spec.ts` asserts on the request for `identity` and for paths,
 * which is the right pattern and is why those field names are correct. It
 * simply never looked at these two. A request-asserting test only catches
 * what someone thought to assert, and nobody questions a constant — which is
 * the argument for auditing a client's body against the schema that receives
 * it rather than relying on the client's own suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

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

const { RestClient } = await import('./RestClient');

const bodies: Array<Record<string, unknown>> = [];

beforeEach(() => {
  store.clear();
  bodies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          session: { token: 't', contactId: 'c', workspaceId: 'w', brandId: 'b', channelId: 'ch' },
          workspace: { id: 'w', name: 'W' },
          realtimeUrl: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
});

describe('RestClient.init: locale and timezone', () => {
  it('reports the device values rather than en-US / UTC', async () => {
    await new RestClient({ publicId: 'pub_test' }).init();

    const body = bodies.at(-1) ?? {};
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    expect(body['locale']).toBe(resolved.locale);
    expect(body['timezone']).toBe(resolved.timeZone);
  });

  it('lets the app override both, for its own language picker', async () => {
    // A user who chose English inside a German phone's settings should reach
    // an English-speaking agent, so the app's choice has to win.
    await new RestClient({
      publicId: 'pub_test',
      locale: 'de-DE',
      timezone: 'Europe/Berlin',
    }).init();

    const body = bodies.at(-1) ?? {};
    expect(body['locale']).toBe('de-DE');
    expect(body['timezone']).toBe('Europe/Berlin');
  });

  it('sends neither field when Intl is unavailable, rather than a fiction', async () => {
    // Hermes can be built without Intl, and `resolvedOptions()` can throw on
    // a device with no configured region. Absent is honest; `en-US` was not.
    const realIntl = globalThis.Intl;
    try {
      vi.stubGlobal('Intl', {
        DateTimeFormat: () => {
          throw new Error('no Intl in this build');
        },
      });
      await new RestClient({ publicId: 'pub_test' }).init();
      const body = bodies.at(-1) ?? {};
      expect(body['locale']).toBeUndefined();
      expect(body['timezone']).toBeUndefined();
    } finally {
      vi.stubGlobal('Intl', realIntl);
    }
  });
});

/**
 * The DURABLE read receipt, which no mobile SDK had.
 *
 * `POST /v1/widget/conversations/{id}/read` was called only by the web
 * widget, while `ChatlyWidget` and `ChatlyProvider` both render the unread
 * badge from the server's own `unreadContactCount` — so the count could only
 * go UP, survived app restarts, and the agent inbox never learned a native
 * visitor had seen the thread.
 *
 * The URL is asserted, not only the body. The Flutter version of this same
 * method shipped its first draft with an ESCAPED interpolation, posting to a
 * literal `/conversations/$conversationId/read`; only a test that reads the
 * path can see that class of mistake.
 */
describe('RestClient.markRead', () => {
  const paths: string[] = [];

  it('posts to the conversation path with the id encoded', async () => {
    paths.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        paths.push(new URL(url).pathname);
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    await new RestClient({ publicId: 'pub_test' }).markRead('conv 7', 'msg_9');

    // Encoded, because a conversation id reaches this from app code.
    expect(paths.at(-1)).toBe('/v1/widget/conversations/conv%207/read');
    const body = bodies.at(-1) ?? {};
    expect(body['publicId']).toBe('pub_test');
    expect(body['upToMessageId']).toBe('msg_9');
  });

  it('omits upToMessageId when the app does not track it', async () => {
    paths.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        paths.push(new URL(url).pathname);
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    await new RestClient({ publicId: 'pub_test' }).markRead('conv_7');

    // Absent, not null: the server reads absence as "read as of now".
    // `in`, not `Object.hasOwn`: this package's lib target predates es2022.
    expect('upToMessageId' in (bodies.at(-1) ?? {})).toBe(false);
  });
});
