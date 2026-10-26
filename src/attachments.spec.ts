/**
 * What a picker hands back, turned into bytes.
 *
 * The contract was bytes-only, and no Expo picker returns bytes — so every
 * Expo app wrote a `fetch(uri)` read or a base64 decoder before it could
 * attach a photo. These pin the three shapes and the two defaults, because
 * the pickers do not always supply a filename or a type.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { decodeBase64, resolveAttachment } from './attachments';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decodeBase64', () => {
  it('decodes without atob, at every padding length', () => {
    // `atob` arrived in Hermes only in RN 0.74 and the ask named engines
    // without it, so this is hand-rolled and has to be right at each
    // remainder: 0, 1 and 2 bytes over a 3-byte group.
    const dec = (s: string): string => new TextDecoder().decode(decodeBase64(s));
    expect(dec('YWJj')).toBe('abc');
    expect(dec('YQ==')).toBe('a');
    expect(dec('YWI=')).toBe('ab');
    expect(dec('')).toBe('');
  });

  it('tolerates whitespace, and refuses a character outside the alphabet', () => {
    // A base64 field that crossed a native bridge or JSON can carry newlines.
    expect(new TextDecoder().decode(decodeBase64('YW\nJj'))).toBe('abc');
    expect(() => decodeBase64('YWJ$')).toThrow(/invalid character/);
  });

  it('returns no trailing zero bytes for a padded input', () => {
    // The output is allocated from the input length, so a padded input leaves
    // the buffer longer than the content — returning it whole would append
    // NULs to an upload.
    expect(decodeBase64('YQ==')).toHaveLength(1);
  });
});

describe('resolveAttachment', () => {
  it('takes bytes as they are', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await resolveAttachment({ bytes, filename: 'a.png', mimeType: 'image/png' });
    expect(out).toEqual({ bytes, filename: 'a.png', mimeType: 'image/png' });
  });

  it('decodes base64, including a data: prefix some pickers hand back whole', async () => {
    const out = await resolveAttachment({ base64: 'data:image/png;base64,YWJj', uri: 'x/p.png' });
    expect(new TextDecoder().decode(out.bytes)).toBe('abc');
    expect(out.filename).toBe('p.png');
  });

  it('reads a uri, which is what every Expo picker actually returns', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([9, 8]).buffer,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const out = await resolveAttachment({ uri: 'file:///tmp/photo%20one.jpg' });
    expect([...out.bytes]).toEqual([9, 8]);
    // Decoded, so a space in a filename does not reach the presign as `%20`.
    expect(out.filename).toBe('photo one.jpg');
    expect(out.mimeType).toBe('image/jpeg');
  });

  it('prefers base64 over uri, so the file is read once', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await resolveAttachment({ base64: 'YWJj', uri: 'file:///tmp/a.bin' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to octet-stream and `attachment` rather than guessing', async () => {
    const out = await resolveAttachment({ bytes: new Uint8Array([0]) });
    expect(out.filename).toBe('attachment');
    expect(out.mimeType).toBe('application/octet-stream');
  });

  it('says the read failed rather than uploading nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 })),
    );
    await expect(resolveAttachment({ uri: 'file:///gone.jpg' })).rejects.toThrow(/could not read/);
  });

  it('refuses a result carrying none of the three', async () => {
    await expect(resolveAttachment({ filename: 'a.png' })).rejects.toThrow(/nothing to upload/);
  });
});
