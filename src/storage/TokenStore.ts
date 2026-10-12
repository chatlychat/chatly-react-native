/**
 * Persistent storage for the visitor token. Mirrors the browser SDK's
 * `localStorage` key convention so a hand-off between web and mobile sessions
 * could in principle reuse the same identifier shape: `chatly:vt:${publicId}`.
 *
 * Uses `@react-native-async-storage/async-storage` (peer dependency). We
 * intentionally require it lazily so the SDK does not crash at import time
 * if the host app forgot to install it — instead we throw a clear error
 * when the token store is first used.
 */

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

let cachedStorage: AsyncStorageLike | null = null;

function getStorage(): AsyncStorageLike {
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
      '[@chatlychat/react-native] @react-native-async-storage/async-storage is required. ' +
        'Install it in your app: `npm install @react-native-async-storage/async-storage`. ' +
        `Underlying error: ${(err as Error).message}`,
    );
  }
}

export class TokenStore {
  private readonly key: string;

  public constructor(publicId: string) {
    this.key = `chatly:vt:${publicId}`;
  }

  public async get(): Promise<string | null> {
    return getStorage().getItem(this.key);
  }

  public async set(value: string): Promise<void> {
    await getStorage().setItem(this.key, value);
  }

  public async clear(): Promise<void> {
    await getStorage().removeItem(this.key);
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

  public constructor(publicId: string) {
    this.key = `chatly:id:${publicId}`;
  }

  public async get(): Promise<StoredIdentity | null> {
    const raw = await getStorage().getItem(this.key);
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
    await getStorage().setItem(this.key, JSON.stringify(value));
  }

  public async clear(): Promise<void> {
    await getStorage().removeItem(this.key);
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
