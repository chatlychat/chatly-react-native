/**
 * Turning whatever a React Native picker returned into bytes.
 *
 * ═══ WHY THIS EXISTS ══════════════════════════════════════════════════════
 *
 * The composer's paperclip used to accept only
 * `{ bytes: Uint8Array, filename, mimeType }`. No Expo picker returns that:
 * `expo-image-picker` and `expo-document-picker` both hand back a file `uri`,
 * and optionally `base64`. So every Expo app wrote the same glue — a
 * `fetch(uri)` read, or a base64 decoder, because some RN engines have no
 * `atob` — before it could attach a photo. Crossly reported it after moving
 * their buyer app onto 0.11.
 *
 * So the SDK reads the file. A picker may return bytes, a `uri`, or `base64`,
 * and `filename` / `mimeType` are optional because the pickers do not always
 * supply them.
 *
 * ═══ WHY `fetch` AND NOT A FILESYSTEM MODULE ══════════════════════════════
 *
 * `expo-file-system` would read a `file://` uri more directly and is a
 * dependency this package will not take — it has none, by design, and a
 * consumer adding one has to rebuild. React Native's `fetch` handles
 * `file://`, `content://` and `ph://` on the platforms that produce them, so
 * the zero-dependency path is also the portable one.
 */

/** What a picker may hand back. One of bytes, a uri, or base64. */
export interface PickedAttachment {
  readonly bytes?: Uint8Array | undefined;
  readonly uri?: string | undefined;
  readonly base64?: string | undefined;
  readonly filename?: string | undefined;
  readonly mimeType?: string | undefined;
}

/** What `uploadAttachment` needs. */
export interface ResolvedAttachment {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
}

/**
 * Decode base64 without `atob`.
 *
 * Hermes has `atob` only from RN 0.74, and the ask named engines without it.
 * Twelve lines is cheaper than a dependency or a version floor.
 *
 * Whitespace is stripped because a base64 field that travelled through JSON
 * or a native bridge can carry newlines, and `=` padding is simply absent
 * from the table so it terminates the run.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function decodeBase64(input: string): Uint8Array {
  const s = input.replace(/[\s=]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v === -1) {
      throw new Error(`that picker returned base64 with an invalid character (${ch}).`);
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }
  // `at` can fall short of the allocated length when the input was padded, so
  // the view is trimmed rather than returning trailing zero bytes as content.
  return at === out.length ? out : out.subarray(0, at);
}

/** The last path segment of a uri, query and fragment removed. */
function filenameFromUri(uri: string): string | undefined {
  const path = uri.split(/[?#]/)[0] ?? uri;
  const last = path.split('/').pop();
  return last !== undefined && last !== '' ? decodeURIComponent(last) : undefined;
}

/**
 * The handful of types a photo or document picker actually produces.
 *
 * Deliberately short. A full table would be a second list to maintain, and
 * anything missing falls back to `application/octet-stream`, which the
 * presign route accepts — the server validates against its own allow-list, so
 * guessing wrong here is refused there rather than smuggled past.
 */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

function mimeFromName(name: string | undefined): string | undefined {
  const ext = name?.split('.').pop()?.toLowerCase();
  return ext === undefined ? undefined : BY_EXTENSION[ext];
}

/**
 * Resolve a picker result to bytes, reading the file when it gave a uri.
 *
 * Order is bytes, then base64, then uri: a picker that supplied bytes or
 * base64 has already done the read, so re-fetching the uri would be a second
 * one. `base64` before `uri` because `expo-image-picker` returns BOTH when
 * asked for base64, and the in-memory copy is the cheaper of the two.
 */
export async function resolveAttachment(picked: PickedAttachment): Promise<ResolvedAttachment> {
  const filename = picked.filename ?? filenameFromUri(picked.uri ?? '') ?? 'attachment';
  const mimeType = picked.mimeType ?? mimeFromName(filename) ?? 'application/octet-stream';

  if (picked.bytes !== undefined) {
    return { bytes: picked.bytes, filename, mimeType };
  }
  if (picked.base64 !== undefined) {
    // `data:image/png;base64,AAAA` is what some pickers hand back verbatim.
    const comma = picked.base64.indexOf(',');
    const body =
      picked.base64.startsWith('data:') && comma !== -1
        ? picked.base64.slice(comma + 1)
        : picked.base64;
    return { bytes: decodeBase64(body), filename, mimeType };
  }
  if (picked.uri !== undefined) {
    const res = await fetch(picked.uri);
    if (!res.ok) {
      throw new Error(`could not read that file (${String(res.status)} from the picker's uri).`);
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()), filename, mimeType };
  }
  throw new Error(
    'that picker returned none of bytes, base64 or uri, so there is nothing to upload.',
  );
}
