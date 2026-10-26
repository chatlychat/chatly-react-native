/**
 * CRX-1: the host can hand the SDK its own storage, and nothing changes for a
 * host that does not. The injected path never touches the AsyncStorage
 * `require`, so these run with no AsyncStorage on disk at all.
 */
import { describe, expect, it, vi } from 'vitest';

import { IdentityStore, TokenStore } from './TokenStore';
import { RestClient } from '../client/RestClient';

import type { ChatlyStorage } from './TokenStore';

function memory(asyncApi: boolean): ChatlyStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return asyncApi
    ? {
        map,
        getItem: async (k) => map.get(k) ?? null,
        setItem: async (k, v) => void map.set(k, v),
        removeItem: async (k) => void map.delete(k),
      }
    : {
        map,
        getItem: (k) => map.get(k) ?? null,
        setItem: (k, v) => void map.set(k, v),
        removeItem: (k) => void map.delete(k),
      };
}

describe.each([
  ['async (AsyncStorage-shaped)', true],
  ['sync (MMKV-shaped)', false],
])('injected storage, %s', (_name, asyncApi) => {
  it('round-trips the token under chatly:vt:<publicId>', async () => {
    const storage = memory(asyncApi);
    const store = new TokenStore('pub_x', storage);
    await store.set('tok');
    expect(storage.map.get('chatly:vt:pub_x')).toBe('tok');
    expect(await store.get()).toBe('tok');
    await store.clear();
    expect(await store.get()).toBeNull();
  });

  it('round-trips the identity', async () => {
    const storage = memory(asyncApi);
    const store = new IdentityStore('pub_x', storage);
    await store.set({ externalId: 'u-1' });
    expect(await store.get()).toEqual({ externalId: 'u-1' });
  });
});

it('config.storage reaches the token store through RestClient', async () => {
  const storage = memory(true);
  storage.map.set('chatly:vt:pub_x', 'from-host');
  const client = new RestClient({ publicId: 'pub_x', apiHost: 'api.test', storage });
  expect(await client.getToken()).toBe('from-host');
});

it('with nothing injected it still falls back to the AsyncStorage require', async () => {
  // The web build of AsyncStorage is a shim over window.localStorage.
  const disk = new Map<string, string>([['chatly:vt:pub_x', 'from-fallback']]);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    },
  });
  expect(await new TokenStore('pub_x').get()).toBe('from-fallback');
  vi.unstubAllGlobals();
});
