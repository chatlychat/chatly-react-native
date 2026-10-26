/**
 * Persistent storage for the visitor token. Mirrors the browser SDK's
 * `localStorage` key convention so a hand-off between web and mobile sessions
 * could in principle reuse the same identifier shape: `chatly:vt:${publicId}`.
 *
 * Uses the host's `storage` (`ChatlyConfig.storage`) when given; otherwise
 * falls back to `@react-native-async-storage/async-storage` (optional peer),
 * required lazily so the SDK does not crash at import time if it is absent —
 * instead we throw a clear error when the token store is first used.
 */

/**
 * The three methods the SDK uses. Same names as `KeyValueStorage` in
 * `@chatlychat/core` (restated: the core is private), but each may also return
 * a promise, so AsyncStorage 1.x/2.x fits as-is and a sync store (MMKV behind a
 * three-line wrapper, expo-secure-store likewise) fits too.
 */
export type ChatlyStorage = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
};
type AsyncStorageLike = ChatlyStorage;

let cachedStorage: AsyncStorageLike | null = null;

function getStorage(injected?: ChatlyStorage): AsyncStorageLike {
  if (injected !== undefined) {
    return injected;
  }
  if (cachedStorage !== null) {
    return cachedStorage;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- RN peer-dep loaded lazily.
    const mod = require('@react-native-async-storage/async-storage') as {
      default?: AsyncStorageLike;
    } & Partial<AsyncStorageLike>;
    const storage = mod.default ?? (mod as unknown as AsyncStorageLike);
    if (typeof storage.getItem !== 'function') {
      throw new Error('module loaded but does not expose getItem');
    }
    cachedStorage = storage;
    return storage;
  } catch (err) {
    throw new Error(
      '[@chatlychat/react-native] no storage available. Pass `storage` in the config, or ' +
        'install the fallback: `npm install @react-native-async-storage/async-storage`. ' +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

export class TokenStore {
  private readonly key: string;

  public constructor(
    publicId: string,
    private readonly storage?: ChatlyStorage,
  ) {
    this.key = `chatly:vt:${publicId}`;
  }

  public async get(): Promise<string | null> {
    return getStorage(this.storage).getItem(this.key);
  }

  public async set(value: string): Promise<void> {
    await getStorage(this.storage).setItem(this.key, value);
  }

  public async clear(): Promise<void> {
    await getStorage(this.storage).removeItem(this.key);
  }
}

/**
 * Persistent store for the identity this device last successfully asserted.
 *
 * Kept for the same reason the browser widget keeps `chatly:xid:` /
 * `chatly:vh:`: the visitor token is now an opaque signed credential rather
 * than the external id itself, so when the server refuses a stale token this
 * is the only way the SDK can re-assert who the host app said this person was
 * without waiting for the app to call `identify()` again. Conversation history
 * hangs off the contact, so replaying the identity brings all of it back.
 *
 * Only ever holds an identity the SERVER ACCEPTED (see `RestClient.init`) —
 * remembering a rejected hash would replay it on every subsequent request and
 * turn one 403 into a permanently broken SDK.
 *
 * Not a secret: the host app put it here, and `userHash` is an HMAC of a value
 * the host app already knows.
 */
export class IdentityStore {
  private readonly key: string;

  public constructor(
    publicId: string,
    private readonly storage?: ChatlyStorage,
  ) {
    this.key = `chatly:id:${publicId}`;
  }

  public async get(): Promise<StoredIdentity | null> {
    const raw = await getStorage(this.storage).getItem(this.key);
    if (raw === null) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as StoredIdentity;
      return typeof parsed?.externalId === 'string' ? parsed : null;
    } catch {
      // A corrupt entry is indistinguishable from no entry as far as the
      // caller is concerned: re-init anonymously rather than throwing.
      return null;
    }
  }

  public async set(value: StoredIdentity): Promise<void> {
    await getStorage(this.storage).setItem(this.key, JSON.stringify(value));
  }

  public async clear(): Promise<void> {
    await getStorage(this.storage).removeItem(this.key);
  }
}

/**
 * Structurally the SDK's `ChatlyIdentity`, restated here so `storage/` does
 * not depend on `client/` (the dependency runs the other way).
 */
export interface StoredIdentity {
  externalId: string;
  email?: string;
  name?: string;
  userHash?: string;
  attributes?: Record<string, unknown>;
}
