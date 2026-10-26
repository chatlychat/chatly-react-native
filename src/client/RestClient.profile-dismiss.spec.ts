/**
 * `resolveProfile` and `dismiss`: asserted on what was SENT (URL and body),
 * against `widgetProfileResolveSchema` / `widgetDismissConversationSchema`
 * (`apps/api/src/modules/widget`). A recording transport that answers anything
 * would agree with a wrong path, so the path and the keys are the assertions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const { RestClient } = await import('./RestClient');

const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const PROFILE = {
  profile: 'vip',
  matched: true,
  starterPrompts: ['Track my order'],
  quickLinks: [{ label: 'Returns', href: 'https://x.test/r' }],
  copy: { composerSend: 'Go' },
};

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(url.endsWith('/resolve') ? PROFILE : {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

const client = () =>
  new RestClient({
    publicId: 'pub_t',
    locale: 'fr-FR',
    storage: { getItem: () => 'tok', setItem: () => undefined, removeItem: () => undefined },
  });

describe('RestClient.resolveProfile', () => {
  it('POSTs /v1/widget/profile/resolve with publicId, visitorToken and the locale', async () => {
    const got = await client().resolveProfile();
    expect(calls[0]?.url).toMatch(/\/v1\/widget\/profile\/resolve$/);
    expect(calls[0]?.body).toEqual({ publicId: 'pub_t', visitorToken: 'tok', locale: 'fr-FR' });
    expect(got.starterPrompts).toEqual(['Track my order']);
    expect(got.quickLinks[0]?.label).toBe('Returns');
  });

  it('an explicit locale beats the configured one', async () => {
    await client().resolveProfile('de-DE');
    expect(calls[0]?.body['locale']).toBe('de-DE');
  });
});

describe('RestClient.dismiss', () => {
  it('POSTs /v1/widget/conversations/:id/dismiss with no conversationId in the body', async () => {
    await client().dismiss('c/1');
    expect(calls[0]?.url).toMatch(/\/v1\/widget\/conversations\/c%2F1\/dismiss$/);
    expect(calls[0]?.body).toEqual({ publicId: 'pub_t', visitorToken: 'tok' });
  });
});
