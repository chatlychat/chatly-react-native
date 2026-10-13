/**
 * What `uploadAttachment` SENDS.
 *
 * It posted `{ publicId, visitorToken, filename, mimeType, data }` — a
 * base64 blob — to `POST /v1/widget/uploads/presign`, whose schema
 * (`apps/api/src/modules/widget/widget.schemas.ts:267-273`) is
 * `{ visitorToken, publicId, filename, contentType, sizeBytes }` and takes no
 * bytes at all. zod drops `mimeType` and `data` as unknown keys and answers
 * 400 on the missing `contentType`, so no attachment has ever been uploaded
 * from this SDK.
 *
 * Every assertion here is on the REQUEST. A fake transport that answers the
 * presign route with a stored attachment agrees with the old bug perfectly —
 * which is exactly how this shipped with a green suite.
 *
 * The real flow is three steps (contract doc §2):
 *   1. presign  → { uploadId, url, method, headers, publicUrl, expiresAt }
 *   2. <method> url, every header from `headers`, body = the raw bytes
 *   3. the attachment on the message:
 *      { id: uploadId, filename, mimeType: contentType, sizeBytes, url: publicUrl }
 *
 * Note the rename between 1 and 3: presign calls it `contentType`, the
 * attachment calls it `mimeType`, and both are the same string.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

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

import { ChatlyRequestError, RestClient } from './RestClient';

const PUBLIC_ID = 'pub_test';
const TOKEN_KEY = `chatly:vt:${PUBLIC_ID}`;

interface Call {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const calls: Call[] = [];

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const PRESIGNED = {
  uploadId: 'up_123',
  url: 'https://s3.test/bucket/workspaces/w-1/up_123.png?sig=abc',
  method: 'PUT',
  headers: { 'content-type': 'image/png', 'x-amz-acl': 'private' },
  publicUrl: 'https://cdn.test/workspaces/w-1/up_123.png',
  expiresAt: '2026-10-12T23:00:00.000Z',
};

/** Records every request and answers the presign route only. */
function installTransport(
  presignResponse: () => Response = () => json(200, PRESIGNED),
  storageStatus = 200,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      const u = new URL(url);
      calls.push({
        url,
        path: u.pathname,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body,
      });
      if (u.pathname === '/v1/widget/uploads/presign') {
        return Promise.resolve(presignResponse());
      }
      if (u.host === 's3.test') {
        return Promise.resolve(new Response('', { status: storageStatus }));
      }
      return Promise.resolve(json(404, { error: { code: 'not_found' } }));
    }),
  );
}

function newClient(): RestClient {
  return new RestClient({ publicId: PUBLIC_ID, apiHost: 'api.test' });
}

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function presignBody(): Record<string, unknown> {
  const call = calls.find((c) => c.path === '/v1/widget/uploads/presign');
  if (call === undefined) {
    throw new Error('nothing was posted to /v1/widget/uploads/presign');
  }
  return JSON.parse(String(call.body)) as Record<string, unknown>;
}

beforeEach(() => {
  calls.length = 0;
  store.clear();
  store.set(TOKEN_KEY, 'vt_live');
});

describe('the presign request', () => {
  it('carries contentType and sizeBytes', async () => {
    installTransport();
    await newClient().uploadAttachment({
      bytes: BYTES,
      filename: 'screenshot.png',
      mimeType: 'image/png',
    });
    const body = presignBody();
    expect(body['contentType']).toBe('image/png');
    expect(body['sizeBytes']).toBe(BYTES.byteLength);
  });

  it('does NOT carry mimeType or a bytes payload — zod drops both', async () => {
    installTransport();
    await newClient().uploadAttachment({
      bytes: BYTES,
      filename: 'screenshot.png',
      mimeType: 'image/png',
    });
    const body = presignBody();
    expect('mimeType' in body).toBe(false);
    expect('data' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual([
      'contentType',
      'filename',
      'publicId',
      'sizeBytes',
      'visitorToken',
    ]);
  });

  it('identifies the visitor the way every other widget call does', async () => {
    installTransport();
    await newClient().uploadAttachment({
      bytes: BYTES,
      filename: 'a.png',
      mimeType: 'image/png',
    });
    const body = presignBody();
    expect(body['publicId']).toBe(PUBLIC_ID);
    expect(body['visitorToken']).toBe('vt_live');
  });
});

describe('the storage PUT', () => {
  it('sends the raw bytes with the returned method and every returned header', async () => {
    installTransport();
    await newClient().uploadAttachment({
      bytes: BYTES,
      filename: 'a.png',
      mimeType: 'image/png',
    });
    const put = calls.find((c) => c.url.startsWith('https://s3.test/'));
    expect(put).toBeDefined();
    expect(put?.method).toBe('PUT');
    expect(put?.headers).toEqual(PRESIGNED.headers);
    // The bytes themselves — not multipart, not base64, not JSON.
    expect(put?.body).toBe(BYTES);
  });

  it('returns the attachment a message carries, renaming contentType to mimeType', async () => {
    installTransport();
    const attachment = await newClient().uploadAttachment({
      bytes: BYTES,
      filename: 'a.png',
      mimeType: 'image/png',
    });
    expect(attachment).toEqual({
      id: PRESIGNED.uploadId,
      filename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: BYTES.byteLength,
      url: PRESIGNED.publicUrl,
    });
  });

  it('fails loudly when object storage refuses the bytes', async () => {
    installTransport(() => json(200, PRESIGNED), 403);
    await expect(
      newClient().uploadAttachment({ bytes: BYTES, filename: 'a.png', mimeType: 'image/png' }),
    ).rejects.toThrow(/403/);
  });

  it('names the real reason when the deployment has no object storage', async () => {
    installTransport(() => json(200, { ...PRESIGNED, url: 'data:,dev-sentinel' }));
    await expect(
      newClient().uploadAttachment({ bytes: BYTES, filename: 'a.png', mimeType: 'image/png' }),
    ).rejects.toThrow(/not configured/i);
    // Nothing was PUT anywhere.
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
});

/**
 * The route refuses before presigning on three conditions and the copy is
 * written for the visitor to read. Collapsing them into "Upload failed" is
 * throwing away the only part of the answer that tells them what to do.
 */
describe('the three refusals the route can answer', () => {
  const refusals = [
    'File uploads are turned off for this chat',
    'That file type is not accepted: application/x-msdownload',
    'Files must be under 10 MB',
  ];

  for (const message of refusals) {
    it(`surfaces verbatim: "${message}"`, async () => {
      installTransport(() => json(400, { error: { code: 'validation_failed', message } }));
      const err = await newClient()
        .uploadAttachment({ bytes: BYTES, filename: 'a.png', mimeType: 'image/png' })
        .then(
          () => null,
          (e: unknown) => e,
        );
      /*
       * EQUALITY, not `toThrow(message)`. A substring match passes against
       * the old client too: it stringified the whole response body into
       * `[chatly] /v1/widget/uploads/presign failed: 400 {"error":{…}}`, so
       * the copy was technically in there — buried in a developer string no
       * visitor should ever be shown. That is the half this asserts.
       */
      expect((err as Error).message).toBe(message);
    });
  }

  it('exposes the status and code alongside the visitor copy', async () => {
    installTransport(() =>
      json(400, { error: { code: 'validation_failed', message: 'Files must be under 10 MB' } }),
    );
    const err = await newClient()
      .uploadAttachment({ bytes: BYTES, filename: 'a.png', mimeType: 'image/png' })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ChatlyRequestError);
    expect((err as ChatlyRequestError).status).toBe(400);
    expect((err as ChatlyRequestError).code).toBe('validation_failed');
    expect((err as ChatlyRequestError).path).toBe('/v1/widget/uploads/presign');
  });
});

describe('mintRealtimeToken', () => {
  it('posts the conversation it is scoped to', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit) => {
        const u = new URL(url);
        calls.push({
          url,
          path: u.pathname,
          method: init.method ?? 'GET',
          headers: (init.headers ?? {}) as Record<string, string>,
          body: init.body,
        });
        return Promise.resolve(json(200, { token: 'rt_abc', expiresAt: '2026-10-12T23:00:00Z' }));
      }),
    );
    const res = await newClient().mintRealtimeToken('conv-7');
    expect(res.token).toBe('rt_abc');
    const call = calls.find((c) => c.path === '/v1/widget/realtime/token');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.body))).toEqual({
      publicId: PUBLIC_ID,
      visitorToken: 'vt_live',
      conversationId: 'conv-7',
    });
  });
});
